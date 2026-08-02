// ---------------------------------------------------------------------------
// Kavi — Sub-Agent Service
// ---------------------------------------------------------------------------
// Spawns isolated sub-agent sessions with depth limiting, file-backed
// persistence, sandbox tool policies, auto-announce, and orphan detection.
// Used by: sessions_spawn tool, cron jobs, hook execution.

import type { SubAgentConfig, SubAgentResult, SubAgentSnapshot } from '../../types/subAgent';
import type { LlmProviderConfig } from '../../types/provider';
import { generateId } from '../../utils/id';
import {
  createSubAgentSessionContextManager,
  type SubAgentSessionContext,
} from './lifecycle/sessionContext';
import { normalizeSubAgentPrompt } from './lifecycle/sessionContextMessages';
import {
  buildResultFromSnapshot,
  createSubAgentLifecycleManager,
  waitForSubAgentResultPromise,
} from './lifecycle/lifecycleManager';
import type { ActiveSubAgentRunControl } from './lifecycle/phases';
import { createSubAgentRegistryPersistenceManager } from './subAgentRegistryPersistence';
import {
  createSubAgentRuntimeSignalsManager,
  type ScheduledSubAgentLaunchControl,
  type SubAgentAnnounceEvent,
} from './subAgentRuntimeSignals';
import { cloneSubAgentSnapshot } from './lifecycle/stateMachine';
import { createLogger } from '../../utils/logger';
import {
  buildInitialSubAgentMessages,
  buildSubAgentSystemPrompt,
  DEFAULT_SUB_AGENT_MAX_ITERATIONS,
  cloneSubAgentConfig,
  MAX_SPAWN_DEPTH,
  hasExplicitSubAgentMaxIterations,
  normalizeSubAgentMaxIterations,
  normalizeSubAgentTimeoutMs,
} from './lifecycle/runConfig';
import { normalizePreviewText } from './lifecycle/runText';
import { createSubAgentStateRuntime } from './subAgentStateRuntime';
import {
  type PreparedSubAgentSession,
  prepareSubAgentSession as prepareLaunchSession,
  schedulePreparedSubAgentRun as scheduleLaunchRun,
  trackSubAgentResultPromise,
} from './subAgentLaunchScaffolding';
import { createSubAgentLaunchApi } from './subAgentLaunchApi';
import { createSubAgentManagementApi } from './subAgentManagementApi';
import { runPreparedSubAgentSession } from './lifecycle/runPhase';
import { reconcileSubAgentOutcomeMemory } from './subAgentOutcomeReconciliation';
import {
  assertProviderReadyForRequest,
  bindProviderToModel,
  hydrateProviderForRequest,
} from '../llm/support/providerSupport';
import { buildSubAgentRestartRecoveryPlan } from './subAgentRestartRecovery';
import { withAndroidLongHorizonExecutionLease } from '../androidLongHorizonExecution';

export { waitForSubAgentResultPromise };
export { MAX_SPAWN_DEPTH } from './lifecycle/runConfig';
export { isToolAllowedBySandbox } from './subAgentToolAccess';

// ── Constants ────────────────────────────────────────────────────────────

const REGISTRY_KEY = 'kavi-sub-agents';
const REGISTRY_CONTEXTS_KEY = 'kavi-sub-agent-contexts';
const TERMINAL_SUB_AGENT_RETENTION_MS = 30 * 60 * 1000; // Retain terminal workers for 30 minutes.
const MAX_SESSION_CONTEXTS = 20; // LRU cap for in-memory session contexts.
const SESSION_CONTEXT_EVICTION_GRACE_MS = 60_000; // Keep context 60s after terminal event for sessions_send.
const REGISTRY_PERSIST_DEBOUNCE_MS = 200;
const SESSION_CONTEXT_CHECKPOINT_DEBOUNCE_MS = 200;
const MAX_ACTIVITY_LOG_ENTRIES = 10;
const MAX_ACTIVITY_TEXT_CHARS = 220;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 320;
const PROGRESS_ANNOUNCE_INTERVAL_MS = 250;
const QUEUED_LAUNCH_WARNING_MS = 2_000;
const QUEUED_LAUNCH_TIMEOUT_MS = 20_000;
const PERSIST_BLOCKING_TIMEOUT_MS = 2_000;
const FINALIZATION_MAX_TRANSCRIPT_MESSAGES = 18;
const FINALIZATION_MESSAGE_CHAR_LIMIT = 1800;
const FINALIZATION_TOOL_CONTENT_CHAR_LIMIT = 2600;
const FINALIZATION_MIN_REMAINING_MS = 1500;
const FINALIZATION_TIMEOUT_CAP_MS = 12_000;
// A default-budget tool run can contribute one assistant intent and one tool result per
// iteration. The extra pair retains an interruption result plus its recovery instruction.
const SESSION_CONTEXT_MAX_MESSAGES = DEFAULT_SUB_AGENT_MAX_ITERATIONS * 2 + 2;
const SESSION_CONTEXT_MESSAGE_CHAR_LIMIT = 900;
const SESSION_CONTEXT_TOOL_CONTENT_CHAR_LIMIT = 1400;

// ── Active sub-agent tracking ────────────────────────────────────────────

export interface ActiveSubAgent extends SubAgentSnapshot {}

const activeSubAgents = new Map<string, ActiveSubAgent>();
const activeRunControls = new Map<string, ActiveSubAgentRunControl>();
const activeResultPromises = new Map<string, Promise<SubAgentResult>>();
const scheduledSubAgentLaunches = new Map<string, ScheduledSubAgentLaunchControl>();
const logger = createLogger('SubAgent');
let scheduleRegistryPersistRef: () => void = () => undefined;
let scheduleProgressAnnouncementRef: (agent: ActiveSubAgent) => void = () => undefined;
const sessionContextManager = createSubAgentSessionContextManager({
  activeAgents: activeSubAgents,
  maxSessionContexts: MAX_SESSION_CONTEXTS,
  evictionGraceMs: SESSION_CONTEXT_EVICTION_GRACE_MS,
  checkpointDebounceMs: SESSION_CONTEXT_CHECKPOINT_DEBOUNCE_MS,
  finalizationMessageCharLimit: FINALIZATION_MESSAGE_CHAR_LIMIT,
  finalizationToolContentCharLimit: FINALIZATION_TOOL_CONTENT_CHAR_LIMIT,
  sessionContextMaxMessages: SESSION_CONTEXT_MAX_MESSAGES,
  sessionContextMessageCharLimit: SESSION_CONTEXT_MESSAGE_CHAR_LIMIT,
  sessionContextToolContentCharLimit: SESSION_CONTEXT_TOOL_CONTENT_CHAR_LIMIT,
  cloneConfig: (config) => cloneSubAgentConfig(config),
  scheduleRegistryPersist: () => scheduleRegistryPersistRef(),
});
const {
  sanitizePersistedAgentSnapshot,
  hydratePersistedAgentSnapshot,
  refreshSubAgentArtifacts,
  appendTranscriptMessage,
  appendActivity,
  updateAgentProgress,
  markModelResponseObserved,
} = createSubAgentStateRuntime<ActiveSubAgent>({
  cloneAgent,
  sanitizeTranscriptMessage: (message) => sessionContextManager.sanitizeTranscriptMessage(message),
  clearQueuedLaunchWatch: (sessionId) => clearQueuedLaunchWatch(sessionId),
  scheduleProgressAnnouncement: (agent) => scheduleProgressAnnouncementRef(agent),
  maxActivityLogEntries: MAX_ACTIVITY_LOG_ENTRIES,
  maxActivityTextChars: MAX_ACTIVITY_TEXT_CHARS,
  maxToolResultPreviewChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
});
const registryPersistenceManager = createSubAgentRegistryPersistenceManager({
  activeSubAgents,
  sessionContextManager,
  sanitizePersistedAgentSnapshot,
  hydratePersistedAgentSnapshot,
  cloneSubAgentConfig,
  buildSubAgentSystemPrompt,
  buildInitialSubAgentMessages,
  logger,
  registryKey: REGISTRY_KEY,
  registryContextsKey: REGISTRY_CONTEXTS_KEY,
  registryPersistDebounceMs: REGISTRY_PERSIST_DEBOUNCE_MS,
  persistBlockingTimeoutMs: PERSIST_BLOCKING_TIMEOUT_MS,
});
scheduleRegistryPersistRef = () => registryPersistenceManager.scheduleRegistryPersist();

function cloneAgent(agent: ActiveSubAgent): ActiveSubAgent {
  return cloneSubAgentSnapshot(agent);
}

/** Flushes worker state without relying on timers that Android may suspend in the background. */
export async function flushSubAgentRegistryPersistence(): Promise<void> {
  await registryPersistenceManager.persistRegistryNow();
}

// ── Announce system ──────────────────────────────────────────────────────

function clearScheduledProgressAnnouncement(sessionId: string): void {
  subAgentRuntimeSignals.clearScheduledProgressAnnouncement(sessionId);
}

function clearQueuedLaunchWatch(sessionId: string): void {
  subAgentRuntimeSignals.clearQueuedLaunchWatch(sessionId);
}

function resolveScheduledLaunchWithSnapshot(sessionId: string): boolean {
  return subAgentRuntimeSignals.resolveScheduledLaunchWithSnapshot(sessionId);
}

function scheduleQueuedLaunchWatch(agent: ActiveSubAgent, announceFailure: boolean): void {
  subAgentRuntimeSignals.scheduleQueuedLaunchWatch(agent, announceFailure);
}

function announce(
  agent: ActiveSubAgent,
  event: Extract<SubAgentAnnounceEvent, 'started' | 'progress'>,
): void {
  subAgentRuntimeSignals.announce(agent, event);
}

const subAgentRuntimeSignals = createSubAgentRuntimeSignalsManager<ActiveSubAgent>({
  activeSubAgents,
  scheduledSubAgentLaunches,
  cloneAgent,
  buildResultFromSnapshot,
  updateAgentProgress,
  appendActivity,
  normalizePreviewText,
  scheduleRegistryPersist: () => registryPersistenceManager.scheduleRegistryPersist(),
  maxToolResultPreviewChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
  queuedLaunchWarningMs: QUEUED_LAUNCH_WARNING_MS,
  queuedLaunchTimeoutMs: QUEUED_LAUNCH_TIMEOUT_MS,
  progressAnnounceIntervalMs: PROGRESS_ANNOUNCE_INTERVAL_MS,
});
scheduleProgressAnnouncementRef = (agent) =>
  subAgentRuntimeSignals.scheduleProgressAnnouncement(agent);

const subAgentLifecycleManager = createSubAgentLifecycleManager<ActiveSubAgent>({
  activeSubAgents,
  activeRunControls,
  activeResultPromises,
  logger,
  registryPersistenceManager,
  sessionContextManager,
  clearQueuedLaunchWatch,
  clearScheduledProgressAnnouncement,
  resolveScheduledLaunchWithSnapshot,
  cloneAgent,
  updateAgentProgress,
  appendActivity,
  onSubAgentTerminal: (listener) => subAgentRuntimeSignals.onSubAgentTerminal(listener),
  signalTerminal: (agent, event, options) =>
    subAgentRuntimeSignals.signalTerminal(agent, event, options),
  normalizePreviewText,
  maxToolResultPreviewChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
  terminalSubAgentRetentionMs: TERMINAL_SUB_AGENT_RETENTION_MS,
  recoverInterruptedAgent: (agent) => recoverInterruptedSubAgentAfterRestart(agent),
  reconcileOutcome: async (agent) => {
    const prior = agent.outcomeReconciliation;
    const context = sessionContextManager.getSessionContext(agent.sessionId);
    const next = await reconcileSubAgentOutcomeMemory({
      agent,
      config: context?.config,
      messages: context?.messages,
    });
    agent.outcomeReconciliation = next;
    agent.updatedAt = Math.max(agent.updatedAt, next.updatedAt);
    return JSON.stringify(prior) !== JSON.stringify(next);
  },
});

// ── Sandbox filter ───────────────────────────────────────────────────────

async function prepareSubAgentSession(
  config: SubAgentConfig,
): Promise<PreparedSubAgentSession<ActiveSubAgent> | SubAgentResult> {
  return prepareLaunchSession<ActiveSubAgent>({
    config,
    maxSpawnDepth: MAX_SPAWN_DEPTH,
    normalizePrompt: normalizeSubAgentPrompt,
    normalizeMaxIterations: normalizeSubAgentMaxIterations,
    normalizeTimeoutMs: normalizeSubAgentTimeoutMs,
    createSessionId: () => `sub-${Date.now()}-${generateId()}`,
    buildSubAgent: ({ sessionId, depth, timeoutMs, sandboxPolicy, startedAt, config }) => ({
      sessionId,
      parentConversationId: config.parentConversationId,
      parentSessionId: config.parentSessionId,
      agentRunId: config.agentRunId,
      ...(config.workstreamId?.trim() ? { workstreamId: config.workstreamId.trim() } : {}),
      name: config.name,
      depth,
      startedAt,
      updatedAt: startedAt,
      ...(timeoutMs != null ? { deadlineAt: startedAt + timeoutMs } : {}),
      status: 'running',
      sandboxPolicy,
      launchState: 'queued',
      lastProgressAt: startedAt,
      currentActivity: 'Queued to start',
      activityLog: [
        {
          timestamp: startedAt,
          kind: 'status',
          text: 'Started worker task',
        },
      ],
    }),
    activeSubAgents,
    scheduleRegistryPersist: () => registryPersistenceManager.scheduleRegistryPersist(),
    logger,
    announceStarted: (agent) => announce(agent, 'started'),
  });
}

async function runPreparedSubAgent(
  prepared: PreparedSubAgentSession<ActiveSubAgent>,
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<SubAgentResult> {
  return runPreparedSubAgentSession({
    prepared,
    config,
    provider,
    allProviders,
    activeRunControls,
    appendActivity,
    appendTranscriptMessage,
    signalTerminal: (agent, event, options) =>
      subAgentRuntimeSignals.signalTerminal(agent, event, options),
    clearPendingSessionContextCheckpoint: (sessionId) =>
      sessionContextManager.clearPendingSessionContextCheckpoint(sessionId),
    clearSessionContextEviction: (sessionId) =>
      sessionContextManager.clearSessionContextEviction(sessionId),
    finalizationMaxTranscriptMessages: FINALIZATION_MAX_TRANSCRIPT_MESSAGES,
    finalizationMessageCharLimit: FINALIZATION_MESSAGE_CHAR_LIMIT,
    finalizationMinRemainingMs: FINALIZATION_MIN_REMAINING_MS,
    finalizationTimeoutCapMs: FINALIZATION_TIMEOUT_CAP_MS,
    finalizationToolContentCharLimit: FINALIZATION_TOOL_CONTENT_CHAR_LIMIT,
    markModelResponseObserved,
    maxToolResultPreviewChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
    persistRegistryBestEffort: (context) =>
      registryPersistenceManager.persistRegistryBestEffort(context),
    refreshSubAgentArtifacts,
    sanitizeTranscriptMessage: (message) =>
      sessionContextManager.sanitizeTranscriptMessage(message),
    scheduleRegistryPersist: () => registryPersistenceManager.scheduleRegistryPersist(),
    scheduleSessionContextCheckpoint: (context, options) =>
      sessionContextManager.scheduleSessionContextCheckpoint(context, options),
    scheduleSessionContextEvictionWhenDurable: (sessionId, persistOutcome) =>
      sessionContextManager.scheduleSessionContextEvictionWhenDurable(sessionId, persistOutcome),
    storeSessionContext: (context) => sessionContextManager.storeSessionContext(context),
    updateAgentProgress,
  });
}

function schedulePreparedSubAgentRun(
  prepared: PreparedSubAgentSession<ActiveSubAgent>,
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<SubAgentResult> {
  // Schedule on the current JS turn before crossing the native bridge. React Native can defer
  // bridge Promise callbacks after the host activity backgrounds, while microtasks already queued
  // on the JS thread can still begin the worker under the parent chat's existing service lease.
  const scheduledRun = scheduleLaunchRun<ActiveSubAgent>({
    prepared,
    announceFailure: config.announce !== false,
    scheduledSubAgentLaunches,
    scheduleQueuedLaunchWatch,
    buildResultFromSnapshot,
    runPreparedSubAgent: () => runPreparedSubAgent(prepared, config, provider, allProviders),
  });
  return withAndroidLongHorizonExecutionLease(
    {
      leaseId: `sub-agent:${prepared.sessionId}`,
      taskKind: 'sub_agent',
    },
    () => scheduledRun,
  );
}

async function recoverInterruptedSubAgentAfterRestart(agent: ActiveSubAgent): Promise<boolean> {
  const context = sessionContextManager.getSessionContext(agent.sessionId);
  const plan = buildSubAgentRestartRecoveryPlan({ agent, context, now: Date.now() });
  if (!plan || !plan.config.initialMessages) return false;

  const provider = bindProviderToModel(
    await hydrateProviderForRequest(context!.provider),
    plan.config.model,
  );
  assertProviderReadyForRequest(
    provider,
    provider.name ? `Sub-agent provider "${provider.name}"` : 'Sub-agent provider',
  );
  const allProviders = context!.allProviders
    ? await Promise.all(
        context!.allProviders.map(async (candidate) =>
          candidate.id === provider.id ? provider : hydrateProviderForRequest(candidate),
        ),
      )
    : undefined;
  const maxIterations = normalizeSubAgentMaxIterations(plan.config.maxIterations);
  if (
    hasExplicitSubAgentMaxIterations(plan.config.maxIterations) &&
    (agent.iterations ?? 0) >= maxIterations
  ) {
    return false;
  }
  const resumedAt = Date.now();
  const remainingTimeoutMs =
    agent.deadlineAt === undefined ? undefined : Math.floor(agent.deadlineAt - resumedAt);
  if (remainingTimeoutMs !== undefined && remainingTimeoutMs < 1_000) return false;
  const resumedConfig: SubAgentConfig = {
    ...plan.config,
    ...(remainingTimeoutMs !== undefined ? { timeoutMs: remainingTimeoutMs } : {}),
  };

  agent.status = 'running';
  agent.terminationCause = undefined;
  agent.launchState = 'queued';
  agent.output = undefined;
  agent.completionState = undefined;
  agent.modelResponsePendingSince = undefined;
  agent.currentActivity = 'Resuming effect-free work after app restart';
  agent.activeToolName = undefined;
  agent.activeToolStartedAt = undefined;
  agent.updatedAt = resumedAt;
  agent.lastProgressAt = resumedAt;
  if (remainingTimeoutMs !== undefined) {
    agent.deadlineAt = resumedAt + remainingTimeoutMs;
  }
  appendActivity(agent, 'status', 'Resuming effect-free work after app restart');

  sessionContextManager.storeSessionContext({
    sessionId: agent.sessionId,
    config: resumedConfig,
    provider,
    allProviders,
    systemPrompt: buildSubAgentSystemPrompt(resumedConfig, agent.depth),
    conversationSummary: context!.conversationSummary,
    messages: plan.config.initialMessages,
  });
  await registryPersistenceManager.persistRegistryNow();

  const timeoutMs = remainingTimeoutMs ?? normalizeSubAgentTimeoutMs(resumedConfig.timeoutMs);
  const prepared: PreparedSubAgentSession<ActiveSubAgent> = {
    sessionId: agent.sessionId,
    depth: agent.depth,
    maxIterations,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    sandboxPolicy: agent.sandboxPolicy,
    subAgent: agent,
  };
  const resultPromise = trackSubAgentResultPromise(
    agent.sessionId,
    schedulePreparedSubAgentRun(prepared, resumedConfig, provider, allProviders),
    activeResultPromises,
  );
  subAgentLifecycleManager.observeBackgroundSubAgentResult(
    { sessionId: agent.sessionId, resultPromise },
    { announce: resumedConfig.announce !== false },
  );
  return true;
}

export async function waitForSubAgentCompletion(
  sessionId: string,
  waitTimeoutMs?: number,
  signal?: AbortSignal,
): Promise<SubAgentResult | null> {
  return subAgentLifecycleManager.waitForSubAgentCompletion(sessionId, waitTimeoutMs, signal);
}

export function observeBackgroundSubAgentResult(
  started: { sessionId: string; resultPromise: Promise<SubAgentResult> },
  options?: { announce?: boolean },
): void {
  subAgentLifecycleManager.observeBackgroundSubAgentResult(started, options);
}

// ── Sub-agent launch helpers ─────────────────────────────────────────────

export const { startSubAgent, spawnSubAgent, launchSubAgent } =
  createSubAgentLaunchApi<ActiveSubAgent>({
    prepareSubAgentSession,
    schedulePreparedSubAgentRun,
    runPreparedSubAgent,
    trackSubAgentResultPromise: (sessionId, resultPromise) =>
      trackSubAgentResultPromise(sessionId, resultPromise, activeResultPromises),
    persistPreparedSubAgentLaunchStateBestEffort: (prepared, config, provider, allProviders) =>
      registryPersistenceManager.persistPreparedSubAgentLaunchStateBestEffort(
        prepared,
        config,
        provider,
        allProviders,
      ),
    observeBackgroundSubAgentResult,
  });
export const {
  onSubAgentEvent,
  cancelSubAgent,
  listActiveSubAgents,
  getSubAgent,
  getSessionContext,
  getSubAgentsByParent,
  cleanupSubAgents,
  detectOrphans,
  initSubAgentRegistry,
  resetSubAgentStateForTests: __resetSubAgentStateForTests,
} = createSubAgentManagementApi<ActiveSubAgent, SubAgentSessionContext>({
  activeSubAgents,
  activeRunControls,
  activeResultPromises,
  scheduledSubAgentLaunches,
  registryKey: REGISTRY_KEY,
  registryContextsKey: REGISTRY_CONTEXTS_KEY,
  runtimeSignals: subAgentRuntimeSignals,
  lifecycle: subAgentLifecycleManager,
  sessionContextManager,
  registryPersistenceManager,
});
