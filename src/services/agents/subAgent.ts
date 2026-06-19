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
  cloneSubAgentConfig,
  MAX_SPAWN_DEPTH,
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
const SESSION_CONTEXT_MAX_MESSAGES = 12;
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
  finalizationMaxTranscriptMessages: FINALIZATION_MAX_TRANSCRIPT_MESSAGES,
});
const registryPersistenceManager = createSubAgentRegistryPersistenceManager({
  activeSubAgents,
  sessionContextManager,
  sanitizePersistedAgentSnapshot,
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

function announce(agent: ActiveSubAgent, event: SubAgentAnnounceEvent): void {
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
  announce,
  normalizePreviewText,
  maxToolResultPreviewChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
  terminalSubAgentRetentionMs: TERMINAL_SUB_AGENT_RETENTION_MS,
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
    announce,
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
  return scheduleLaunchRun<ActiveSubAgent>({
    prepared,
    announceFailure: config.announce !== false,
    scheduledSubAgentLaunches,
    scheduleQueuedLaunchWatch,
    buildResultFromSnapshot,
    runPreparedSubAgent: () => runPreparedSubAgent(prepared, config, provider, allProviders),
  });
}

export async function waitForSubAgentCompletion(
  sessionId: string,
  waitTimeoutMs?: number,
): Promise<SubAgentResult | null> {
  return subAgentLifecycleManager.waitForSubAgentCompletion(sessionId, waitTimeoutMs);
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
