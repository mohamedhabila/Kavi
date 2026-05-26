// ---------------------------------------------------------------------------
// Kavi — Sub-Agent Service
// ---------------------------------------------------------------------------
// Spawns isolated sub-agent sessions with depth limiting, file-backed
// persistence, sandbox tool policies, auto-announce, and orphan detection.
// Used by: sessions_spawn tool, cron jobs, hook execution.

import type {
  Conversation,
  SubAgentActivityEntry,
  SubAgentConfig,
  SubAgentResult,
  Message,
  LlmProviderConfig,
  SubAgentSnapshot,
  TokenUsage,
  ToolCall,
} from '../../types';
import { runOrchestrator } from '../../engine/orchestrator';
import { estimateMessageTokens, estimateTokens } from '../context/tokenCounter';
import {
  resolveFinalizationMaxTokens,
  resolveSubAgentMaxTokens,
} from '../context/tokenOptimization';
import { normalizeToolName } from '../../engine/tools/toolNameNormalization';
import {
  getRuntimeToolAvailabilityContext,
  remapRuntimeUnavailableToolNames,
} from '../../engine/tools/runtimeAvailability';
import { generateId } from '../../utils/id';
import { LlmService } from '../llm/LlmService';
import {
  cloneAttachments,
  collectResolvedAttachments,
  stripAttachmentPayloads,
} from '../../utils/messageAttachments';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  normalizeFinalizationOutputText,
  summarizeFinalizationToolResultPreview,
  truncateFinalizationText,
} from './finalizationText';
import {
  recordConversationUsageEvent,
  recordImageToolConversationUsage,
} from '../usage/conversationUsage';
import { cloneSubAgentSnapshot, isTerminalSubAgentStatus } from './workflowState';
import { flushPendingStorageWrites, throttledAsyncStorage } from '../../store/throttledStorage';
import { createLogger } from '../../utils/logger';
import { buildStreamingPreview } from '../../utils/streamingPreview';
import { assertProviderReadyForRequest, hydrateProviderForRequest } from '../llm/providerSupport';
import { PYTHON_EXTENSION_WHEN_NEEDED } from '../python/guidance';
import {
  hasOperationalEvidenceFromSources,
  isArtifactEvidenceSourceName,
  isExternalRunEvidenceSourceName,
  isOperationalEvidenceSourceName,
} from './approvalSignals';

// ── Constants ────────────────────────────────────────────────────────────

export const MAX_SPAWN_DEPTH = 5;
const MAX_ITERATIONS_DEFAULT = 40;
const MIN_SUB_AGENT_MAX_ITERATIONS = 25;
const MIN_TIMEOUT_MS = 1_000;
const OUTPUT_TRUNCATION = FINALIZATION_OUTPUT_TRUNCATION;
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

const TOOL_ACTIVITY_ARGUMENT_KEYS = [
  'path',
  'url',
  'query',
  'command',
  'name',
  'sessionId',
  'pattern',
  'slug',
  'title',
];

// Safe-only tool set: no SSH, no file deletion, no expo builds
const SAFE_ONLY_TOOLS = new Set([
  'read_file',
  'list_files',
  'web_search',
  'web_fetch',
  'glob_search',
  'text_search',
  'read_workflow_evidence',
  'record_workflow_evidence',
  'memory_search',
  'javascript',
  'tool_catalog',
  'canvas_list',
  'canvas_read',
  'canvas_snapshot',
  'sessions_list',
  'sessions_status',
  'sessions_history',
  'sessions_output',
  'sessions_surface_output',
  'sessions_wait',
  'wait',
  'workspace_status',
  'workspace_read_file',
  'workspace_list_files',
  'expo_eas_status',
  'expo_eas_probe',
  'expo_eas_workflow_runs',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
  'browser_snapshot',
  'browser_screenshot',
  'browser_console',
  'browser_errors',
  'browser_network',
  'browser_status',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_hover',
  'browser_select',
  'browser_wait',
  'browser_evaluate',
]);

function isDynamicToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__') || toolName.startsWith('skill__');
}

// ── Active sub-agent tracking ────────────────────────────────────────────

export interface ActiveSubAgent extends SubAgentSnapshot {}

type SubAgentAnnounceEvent =
  | 'started'
  | 'completed'
  | 'timeout'
  | 'error'
  | 'cancelled'
  | 'progress';

type SubAgentAbortReason = 'cancelled' | 'timeout' | 'max-iterations';

interface ActiveSubAgentRunControl {
  abortController: AbortController;
  cancelReason?: string;
  abortReason?: SubAgentAbortReason;
}

interface ScheduledSubAgentLaunchControl {
  handle: ReturnType<typeof setTimeout>;
  resolve: (result: SubAgentResult) => void;
  reject: (error: unknown) => void;
}

interface QueuedLaunchWatch {
  warningHandle?: ReturnType<typeof setTimeout>;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

type PersistRegistryBestEffortOutcome =
  | { status: 'persisted' }
  | { status: 'timed-out'; completion: Promise<boolean> }
  | { status: 'failed' };

// In-memory conversation context for sub-agent session continuity.
// A sanitized checkpoint is persisted separately for recovery, but the live
// working transcript remains in-memory only.
interface SubAgentSessionContext {
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  systemPrompt: string;
  conversationSummary: string;
  messages: Message[];
}

interface SessionContextStoreParams {
  sessionId: string;
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  systemPrompt: string;
  conversationSummary: string;
  messages: Message[];
}

interface PreparedSubAgentSession {
  sessionId: string;
  depth: number;
  maxIterations: number;
  timeoutMs?: number;
  sandboxPolicy: 'full' | 'safe-only' | 'inherit';
  subAgent: ActiveSubAgent;
}

const activeSubAgents = new Map<string, ActiveSubAgent>();
const activeRunControls = new Map<string, ActiveSubAgentRunControl>();
const activeResultPromises = new Map<string, Promise<SubAgentResult>>();
const scheduledSubAgentLaunches = new Map<string, ScheduledSubAgentLaunchControl>();
const queuedLaunchWatches = new Map<string, QueuedLaunchWatch>();
const sessionContexts = new Map<string, SubAgentSessionContext>();
const sessionContextEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSessionContextCheckpoints = new Map<string, SessionContextStoreParams>();
const scheduledSessionContextCheckpoints = new Map<string, ReturnType<typeof setTimeout>>();
const announceListeners = new Set<(agent: ActiveSubAgent, event: SubAgentAnnounceEvent) => void>();
const logger = createLogger('SubAgent');
const scheduledProgressAnnouncements = new Map<string, ReturnType<typeof setTimeout>>();
let registryPersistRequested = false;
let registryPersistChain: Promise<void> = Promise.resolve();
let scheduledRegistryPersist: ReturnType<typeof setTimeout> | undefined;

function scheduleSessionContextEviction(sessionId: string): void {
  clearSessionContextEviction(sessionId);
  const timer = setTimeout(() => {
    sessionContextEvictionTimers.delete(sessionId);
    sessionContexts.delete(sessionId);
  }, SESSION_CONTEXT_EVICTION_GRACE_MS);
  (timer as any)?.unref?.();
  sessionContextEvictionTimers.set(sessionId, timer);
}

function clearSessionContextEviction(sessionId: string): void {
  const timer = sessionContextEvictionTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    sessionContextEvictionTimers.delete(sessionId);
  }
}

function scheduleSessionContextEvictionWhenDurable(
  sessionId: string,
  persistOutcome: PersistRegistryBestEffortOutcome,
): void {
  if (persistOutcome.status === 'persisted') {
    scheduleSessionContextEviction(sessionId);
    return;
  }

  if (persistOutcome.status === 'timed-out') {
    void persistOutcome.completion.then((didPersist) => {
      if (!didPersist) {
        return;
      }

      const latestAgent = activeSubAgents.get(sessionId);
      if (!latestAgent || latestAgent.status === 'running') {
        return;
      }

      scheduleSessionContextEviction(sessionId);
    });
  }
}

function clearQueuedLaunchWatch(sessionId: string): void {
  const watch = queuedLaunchWatches.get(sessionId);
  if (!watch) {
    return;
  }

  if (watch.warningHandle) {
    clearTimeout(watch.warningHandle);
  }
  if (watch.timeoutHandle) {
    clearTimeout(watch.timeoutHandle);
  }

  queuedLaunchWatches.delete(sessionId);
}

function resolveScheduledLaunchWithSnapshot(sessionId: string): boolean {
  const scheduledLaunch = scheduledSubAgentLaunches.get(sessionId);
  const agent = activeSubAgents.get(sessionId);
  if (!scheduledLaunch || !agent) {
    return false;
  }

  clearTimeout(scheduledLaunch.handle);
  scheduledSubAgentLaunches.delete(sessionId);
  scheduledLaunch.resolve(buildResultFromSnapshot(agent));
  return true;
}

function failQueuedLaunch(sessionId: string, message: string, announceFailure: boolean): void {
  const agent = activeSubAgents.get(sessionId);
  if (!agent || agent.status !== 'running' || agent.launchState !== 'queued') {
    return;
  }

  clearQueuedLaunchWatch(sessionId);

  agent.status = 'error';
  agent.launchState = 'terminal';
  agent.output = message;
  agent.currentActivity = normalizePreviewText(message, MAX_TOOL_RESULT_PREVIEW_CHARS);
  agent.activeToolName = undefined;
  agent.activeToolStartedAt = undefined;
  agent.deadlineAt = undefined;
  agent.updatedAt = Date.now();
  appendActivity(agent, 'status', message);

  scheduleRegistryPersist();
  resolveScheduledLaunchWithSnapshot(sessionId);

  if (announceFailure) {
    announce(agent, 'error');
  }
}

function scheduleQueuedLaunchWatch(agent: ActiveSubAgent, announceFailure: boolean): void {
  clearQueuedLaunchWatch(agent.sessionId);

  const warningHandle = setTimeout(() => {
    const latestAgent = activeSubAgents.get(agent.sessionId);
    if (!latestAgent || latestAgent.status !== 'running' || latestAgent.launchState !== 'queued') {
      return;
    }

    updateAgentProgress(
      latestAgent,
      {
        currentActivity: 'Still starting worker runtime',
        launchState: 'queued',
      },
      {
        activityKind: 'status',
        activityText: 'Still starting worker runtime',
        markProgress: false,
      },
    );
  }, QUEUED_LAUNCH_WARNING_MS);
  (warningHandle as any)?.unref?.();

  const timeoutHandle = setTimeout(() => {
    failQueuedLaunch(
      agent.sessionId,
      'Worker launch stalled before bootstrapping. Retry the worker or inspect runtime persistence health.',
      announceFailure,
    );
  }, QUEUED_LAUNCH_TIMEOUT_MS);
  (timeoutHandle as any)?.unref?.();

  queuedLaunchWatches.set(agent.sessionId, {
    warningHandle,
    timeoutHandle,
  });
}

function enforceSessionContextLimit(): void {
  if (sessionContexts.size <= MAX_SESSION_CONTEXTS) {
    return;
  }

  // Evict oldest contexts that belong to terminal agents first.
  const evictableSessions: string[] = [];
  for (const [sessionId] of sessionContexts) {
    const agent = activeSubAgents.get(sessionId);
    if ((!agent || agent.status !== 'running') && !sessionContextEvictionTimers.has(sessionId)) {
      evictableSessions.push(sessionId);
    }
  }

  const evictCount = sessionContexts.size - MAX_SESSION_CONTEXTS;
  for (let i = 0; i < evictCount && i < evictableSessions.length; i++) {
    clearSessionContextEviction(evictableSessions[i]);
    sessionContexts.delete(evictableSessions[i]);
  }
}

function cloneAgent(agent: ActiveSubAgent): ActiveSubAgent {
  return cloneSubAgentSnapshot(agent);
}

function sanitizePersistedAgentSnapshot(agent: ActiveSubAgent): ActiveSubAgent {
  const sanitizedArtifacts = stripAttachmentPayloads(agent.artifacts);

  return {
    ...cloneAgent(agent),
    ...(agent.name ? { name: normalizePreviewText(agent.name, 120) } : {}),
    ...(agent.output ? { output: truncateTranscriptText(agent.output, OUTPUT_TRUNCATION) } : {}),
    ...(agent.toolsUsed ? { toolsUsed: agent.toolsUsed.slice(-10) } : {}),
    ...(agent.currentActivity
      ? { currentActivity: normalizePreviewText(agent.currentActivity, MAX_ACTIVITY_TEXT_CHARS) }
      : {}),
    ...(agent.activeToolName
      ? { activeToolName: normalizePreviewText(agent.activeToolName, 120) }
      : {}),
    ...(agent.lastToolResultPreview
      ? {
          lastToolResultPreview: normalizePreviewText(
            agent.lastToolResultPreview,
            MAX_TOOL_RESULT_PREVIEW_CHARS,
          ),
        }
      : {}),
    ...(agent.activityLog
      ? {
          activityLog: agent.activityLog.slice(-MAX_ACTIVITY_LOG_ENTRIES).map((entry) => ({
            timestamp: entry.timestamp,
            kind: entry.kind,
            text: normalizePreviewText(entry.text, MAX_ACTIVITY_TEXT_CHARS) || entry.text,
          })),
        }
      : {}),
    ...(sanitizedArtifacts ? { artifacts: sanitizedArtifacts } : {}),
  };
}

function normalizePreviewText(
  value: string | undefined,
  maxLength = MAX_ACTIVITY_TEXT_CHARS,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildSubAgentResponsePreview(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const preview = buildStreamingPreview(value, {
    charWindow: 2400,
    maxLines: 6,
    maxChars: MAX_TOOL_RESULT_PREVIEW_CHARS,
  });

  return normalizePreviewText(preview, MAX_TOOL_RESULT_PREVIEW_CHARS);
}

function normalizeSubAgentTimeoutMs(value?: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(Number(value));
  if (normalized <= 0) {
    return undefined;
  }

  return Math.max(MIN_TIMEOUT_MS, normalized);
}

function normalizeSubAgentMaxIterations(value?: number): number {
  if (!Number.isFinite(value)) {
    return MAX_ITERATIONS_DEFAULT;
  }

  const normalized = Math.floor(Number(value));
  if (normalized <= 0) {
    return MAX_ITERATIONS_DEFAULT;
  }

  return Math.max(MIN_SUB_AGENT_MAX_ITERATIONS, normalized);
}

function truncateTranscriptText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = normalizeFinalizationOutputText(value, maxLength);
  if (!normalized) {
    return undefined;
  }

  return normalized.length < maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function coerceToolCallStatus(status: unknown, fallback: ToolCall['status']): ToolCall['status'] {
  return status === 'pending' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'failed'
    ? status
    : fallback;
}

function cloneJsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeTranscriptToolCall(toolCall: ToolCall): ToolCall {
  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: truncateTranscriptText(toolCall.arguments, 1200) || '{}',
    ...(toolCall.raw ? { raw: cloneJsonLike(toolCall.raw) } : {}),
    status: toolCall.status,
    startedAt: toolCall.startedAt,
    updatedAt: toolCall.updatedAt,
    completedAt: toolCall.completedAt,
    progressText: truncateTranscriptText(toolCall.progressText, 400),
    result: truncateTranscriptText(toolCall.result, 1800),
    error: truncateTranscriptText(toolCall.error, 800),
  };
}

function buildSanitizedContextMessage(message: Message, contentLimit: number): Message {
  const sanitizedAttachments = stripAttachmentPayloads(message.attachments);

  return {
    id: message.id,
    role: message.role,
    content: truncateTranscriptText(message.content, contentLimit) || '',
    timestamp: message.timestamp,
    ...(message.enrichedContent
      ? { enrichedContent: truncateTranscriptText(message.enrichedContent, contentLimit) }
      : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(sanitizedAttachments ? { attachments: sanitizedAttachments } : {}),
    ...(message.providerReplay ? { providerReplay: cloneJsonLike(message.providerReplay) } : {}),
    ...(message.assistantMetadata ? { assistantMetadata: { ...message.assistantMetadata } } : {}),
    ...(message.toolCalls?.length
      ? { toolCalls: message.toolCalls.map((toolCall) => sanitizeTranscriptToolCall(toolCall)) }
      : {}),
    ...(message.isError ? { isError: true } : {}),
  };
}

function sanitizeTranscriptMessage(message: Message): Message {
  const contentLimit =
    message.role === 'tool'
      ? FINALIZATION_TOOL_CONTENT_CHAR_LIMIT
      : FINALIZATION_MESSAGE_CHAR_LIMIT;

  return buildSanitizedContextMessage(message, contentLimit);
}

function sanitizeSessionContextMessage(message: Message): Message {
  const contentLimit =
    message.role === 'tool'
      ? SESSION_CONTEXT_TOOL_CONTENT_CHAR_LIMIT
      : SESSION_CONTEXT_MESSAGE_CHAR_LIMIT;

  return buildSanitizedContextMessage(message, contentLimit);
}

function normalizeSubAgentPrompt(prompt: unknown): string | undefined {
  if (typeof prompt !== 'string') {
    return undefined;
  }

  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasSeedUserInstruction(message: Message): boolean {
  return (
    message.role === 'user' &&
    (message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0)
  );
}

function cloneStoredMessage(message: Message): Message {
  const candidate = (message && typeof message === 'object' ? message : {}) as Partial<Message>;
  const role =
    candidate.role === 'system' ||
    candidate.role === 'user' ||
    candidate.role === 'assistant' ||
    candidate.role === 'tool'
      ? candidate.role
      : 'assistant';
  const timestamp =
    typeof candidate.timestamp === 'number' && Number.isFinite(candidate.timestamp)
      ? candidate.timestamp
      : Date.now();
  const id =
    typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id
      : generateId();

  return {
    ...candidate,
    id,
    role,
    content: typeof candidate.content === 'string' ? candidate.content : '',
    timestamp,
    ...(typeof candidate.enrichedContent === 'string'
      ? { enrichedContent: candidate.enrichedContent }
      : {}),
    ...(Array.isArray(candidate.toolCalls)
      ? {
          toolCalls: candidate.toolCalls.map((toolCall) => ({
            ...toolCall,
            ...(toolCall.raw ? { raw: cloneJsonLike(toolCall.raw) } : {}),
          })),
        }
      : {}),
    ...(Array.isArray(candidate.attachments)
      ? { attachments: candidate.attachments.map((attachment) => ({ ...attachment })) }
      : {}),
    ...(candidate.providerReplay
      ? { providerReplay: cloneJsonLike(candidate.providerReplay) }
      : {}),
    ...(candidate.assistantMetadata
      ? { assistantMetadata: { ...candidate.assistantMetadata } }
      : {}),
  };
}

function cloneStoredMessages(messages?: Message[]): Message[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const cloned: Message[] = [];
  for (const message of messages) {
    try {
      cloned.push(cloneStoredMessage(message));
    } catch {
      // Ignore only the malformed entry; valid sibling messages should remain usable.
    }
  }

  return cloned;
}

function cloneProviderConfig(provider: LlmProviderConfig): LlmProviderConfig {
  return {
    ...provider,
    ...(provider.availableModels ? { availableModels: [...provider.availableModels] } : {}),
    ...(provider.hiddenModels ? { hiddenModels: [...provider.hiddenModels] } : {}),
    ...(provider.modelCapabilities ? { modelCapabilities: { ...provider.modelCapabilities } } : {}),
  };
}

function cloneProviderConfigForSessionPersistence(provider: LlmProviderConfig): LlmProviderConfig {
  return {
    ...cloneProviderConfig(provider),
    apiKey: '',
  };
}

function cloneSessionContext(
  context: SubAgentSessionContext,
  options?: { redactProviderSecrets?: boolean },
): SubAgentSessionContext {
  if (!Array.isArray(context.messages)) {
    throw new Error('Malformed stored session context messages');
  }

  const cloneProvider = options?.redactProviderSecrets
    ? cloneProviderConfigForSessionPersistence
    : cloneProviderConfig;

  return {
    config: cloneSubAgentConfig(context.config),
    provider: cloneProvider(context.provider),
    ...(context.allProviders
      ? { allProviders: context.allProviders.map((entry) => cloneProvider(entry)) }
      : {}),
    systemPrompt: context.systemPrompt,
    conversationSummary: context.conversationSummary,
    messages: cloneStoredMessages(context.messages),
  };
}

function coerceConfiguredToolNameInputs(tools: unknown): string[] {
  if (Array.isArray(tools)) {
    return tools.filter((toolName): toolName is string => typeof toolName === 'string');
  }

  if (typeof tools !== 'string') {
    return [];
  }

  const trimmed = tools.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed !== tools) {
      return coerceConfiguredToolNameInputs(parsed);
    }
  } catch {
    // Fall back to delimiter-based parsing below.
  }

  return trimmed
    .split(/[\n,;|]+/)
    .map((toolName) => toolName.trim())
    .filter((toolName) => toolName.length > 0);
}

function normalizeConfiguredToolNames(tools?: unknown): string[] | undefined {
  const normalized = Array.from(
    new Set(
      coerceConfiguredToolNameInputs(tools)
        .map((toolName) => normalizeToolName(toolName))
        .filter((toolName) => toolName.length > 0),
    ),
  );

  return normalized.length ? normalized : undefined;
}

function cloneSubAgentConfig(config: SubAgentConfig): SubAgentConfig {
  const normalizedTools = normalizeConfiguredToolNames(config.tools);
  const prompt = normalizeSubAgentPrompt(config.prompt) || '';
  const workstreamId = config.workstreamId?.trim() || undefined;
  return {
    ...config,
    prompt,
    ...(workstreamId ? { workstreamId } : {}),
    ...(normalizedTools ? { tools: normalizedTools } : {}),
    initialMessages: undefined,
  };
}

function buildInitialSubAgentMessages(config: SubAgentConfig): Message[] {
  const normalizedPrompt = normalizeSubAgentPrompt(config.prompt);
  const initialMessages = cloneStoredMessages(config.initialMessages);

  if (initialMessages.length > 0) {
    if (initialMessages.some((message) => hasSeedUserInstruction(message))) {
      return initialMessages;
    }

    if (normalizedPrompt) {
      return [
        ...initialMessages,
        {
          id: generateId(),
          role: 'user',
          content: normalizedPrompt,
          timestamp: Date.now(),
        },
      ];
    }

    return initialMessages;
  }

  return [
    {
      id: generateId(),
      role: 'user',
      content: normalizedPrompt ?? '',
      timestamp: Date.now(),
    },
  ];
}

function buildSubAgentSystemPrompt(
  config: Pick<SubAgentConfig, 'systemPrompt' | 'inheritMemory'>,
  depth: number,
): string {
  const workerContract = `## Worker Contract
- Use tool results as your ground truth.
- Before a major tool phase, briefly state what you are checking or changing when that helps coordination.
- ${PYTHON_EXTENSION_WHEN_NEEDED}
- Do not end on tool calls alone. Always finish with a concise final report describing what you accomplished, the key verified findings, and any blocker.
- If you are interrupted, timed out, or cancelled, preserve the most useful verified findings in visible text before ending.`;

  const rawSystemPrompt = config.systemPrompt?.trim();
  if (rawSystemPrompt) {
    return `${rawSystemPrompt.slice(0, 50_000)}

${workerContract}`;
  }

  if (config.inheritMemory) {
    return `You are a sub-agent (depth ${depth + 1}/${MAX_SPAWN_DEPTH}) performing a specific task. Use tools as needed.

${workerContract}`;
  }

  return `You are a sub-agent (depth ${depth + 1}/${MAX_SPAWN_DEPTH}). Complete the task and return the result.

${workerContract}`;
}

async function persistPreparedSubAgentLaunchState(
  prepared: Pick<PreparedSubAgentSession, 'sessionId' | 'depth'>,
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<void> {
  scheduleSessionContextCheckpoint(
    {
      sessionId: prepared.sessionId,
      config,
      provider,
      allProviders,
      systemPrompt: buildSubAgentSystemPrompt(config, prepared.depth),
      conversationSummary: '',
      messages: buildInitialSubAgentMessages(config),
    },
    { immediate: true },
  );

  await persistRegistryNow();
}

async function persistPreparedSubAgentLaunchStateBestEffort(
  prepared: Pick<PreparedSubAgentSession, 'sessionId' | 'depth'>,
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const persistPromise = persistPreparedSubAgentLaunchState(
    prepared,
    config,
    provider,
    allProviders,
  );
  const boundedPersistPromise = new Promise<
    'persisted' | 'timed-out' | { kind: 'failed'; error: unknown }
  >((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timed-out'), PERSIST_BLOCKING_TIMEOUT_MS);
    (timeoutHandle as any)?.unref?.();
    void persistPromise
      .then(() => resolve('persisted'))
      .catch((error) => resolve({ kind: 'failed', error }));
  });

  const persistOutcome = await boundedPersistPromise;
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  if (persistOutcome === 'persisted') {
    return;
  }

  if (persistOutcome === 'timed-out') {
    logger.devWarn(
      `Launch persistence exceeded ${PERSIST_BLOCKING_TIMEOUT_MS}ms; continuing in memory for ${prepared.sessionId}.`,
    );
    void persistPromise.catch((error) => {
      logger.devWarn(
        'Launch persistence eventually failed:',
        error instanceof Error ? error.message : String(error),
      );
    });
    return;
  }

  logger.devWarn(
    'Launch persistence failed; continuing in memory:',
    persistOutcome.error instanceof Error
      ? persistOutcome.error.message
      : String(persistOutcome.error),
  );
}

async function persistRegistryBestEffort(
  context: string,
): Promise<PersistRegistryBestEffortOutcome> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const persistPromise = persistRegistryNow();
  const persistOutcome = await new Promise<
    'persisted' | 'timed-out' | { kind: 'failed'; error: unknown }
  >((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timed-out'), PERSIST_BLOCKING_TIMEOUT_MS);
    (timeoutHandle as any)?.unref?.();
    void persistPromise
      .then(() => resolve('persisted'))
      .catch((error) => resolve({ kind: 'failed', error }));
  });

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  if (persistOutcome === 'persisted') {
    return { status: 'persisted' };
  }

  if (persistOutcome === 'timed-out') {
    logger.devWarn(
      `${context}: persistence exceeded ${PERSIST_BLOCKING_TIMEOUT_MS}ms; continuing with in-memory state.`,
    );
    return {
      status: 'timed-out',
      completion: persistPromise
        .then(() => true)
        .catch((error) => {
          logger.devWarn(
            `${context}: background persistence eventually failed:`,
            error instanceof Error ? error.message : String(error),
          );
          return false;
        }),
    };
  }

  logger.devWarn(
    `${context}:`,
    persistOutcome.error instanceof Error
      ? persistOutcome.error.message
      : String(persistOutcome.error),
  );

  return { status: 'failed' };
}

function refreshSubAgentArtifacts(agent: ActiveSubAgent, messages: Message[]): void {
  const artifacts = collectResolvedAttachments(messages);
  agent.artifacts = artifacts?.length ? cloneAttachments(artifacts) : undefined;
}

function buildStoredSessionMessages(messages: Message[], finalOutput?: string): Message[] {
  const sanitized = messages.map((message) => sanitizeSessionContextMessage(message));
  const normalizedOutput = truncateTranscriptText(finalOutput, SESSION_CONTEXT_MESSAGE_CHAR_LIMIT);
  const lastMessage = sanitized[sanitized.length - 1];

  if (
    normalizedOutput &&
    (lastMessage?.role !== 'assistant' || lastMessage.content !== normalizedOutput)
  ) {
    sanitized.push({
      id: generateId(),
      role: 'assistant',
      content: normalizedOutput,
      timestamp: Date.now(),
    });
  }

  return sanitized
    .slice(-SESSION_CONTEXT_MAX_MESSAGES)
    .map((message) => cloneStoredMessage(message));
}

function storeSessionContext(params: SessionContextStoreParams): void {
  // If storing for a running agent, cancel any pending eviction.
  clearSessionContextEviction(params.sessionId);

  sessionContexts.set(params.sessionId, {
    config: cloneSubAgentConfig(params.config),
    provider: cloneProviderConfig(params.provider),
    ...(params.allProviders
      ? { allProviders: params.allProviders.map((entry) => cloneProviderConfig(entry)) }
      : {}),
    systemPrompt: params.systemPrompt,
    conversationSummary: params.conversationSummary,
    messages: buildStoredSessionMessages(params.messages, params.conversationSummary),
  });

  enforceSessionContextLimit();
}

function clearScheduledSessionContextCheckpoint(sessionId: string): void {
  const timer = scheduledSessionContextCheckpoints.get(sessionId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  scheduledSessionContextCheckpoints.delete(sessionId);
}

function clearPendingSessionContextCheckpoint(sessionId: string): void {
  clearScheduledSessionContextCheckpoint(sessionId);
  pendingSessionContextCheckpoints.delete(sessionId);
}

function flushSessionContextCheckpoint(sessionId: string): void {
  clearScheduledSessionContextCheckpoint(sessionId);
  const params = pendingSessionContextCheckpoints.get(sessionId);
  if (!params) {
    return;
  }

  pendingSessionContextCheckpoints.delete(sessionId);
  if (!activeSubAgents.has(sessionId)) {
    return;
  }

  storeSessionContext(params);
  scheduleRegistryPersist();
}

function scheduleSessionContextCheckpoint(
  params: SessionContextStoreParams,
  options?: { immediate?: boolean },
): void {
  clearSessionContextEviction(params.sessionId);
  pendingSessionContextCheckpoints.set(params.sessionId, params);

  if (options?.immediate) {
    flushSessionContextCheckpoint(params.sessionId);
    return;
  }

  if (scheduledSessionContextCheckpoints.has(params.sessionId)) {
    return;
  }

  const timer = setTimeout(() => {
    flushSessionContextCheckpoint(params.sessionId);
  }, SESSION_CONTEXT_CHECKPOINT_DEBOUNCE_MS);
  (timer as any)?.unref?.();
  scheduledSessionContextCheckpoints.set(params.sessionId, timer);
}

function resolveCurrentTaskPrompt(messages: Message[], fallbackPrompt: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') {
      continue;
    }
    const normalized = normalizeFinalizationOutputText(message.content);
    if (normalized) {
      return normalized;
    }
  }

  return fallbackPrompt;
}

function appendTranscriptMessage(messages: Message[], message: Message): void {
  const sanitized = sanitizeTranscriptMessage(message);
  const hasRenderableContent = !!sanitized.content.trim();
  const hasToolCalls = (sanitized.toolCalls?.length || 0) > 0;
  if (!hasRenderableContent && !hasToolCalls && sanitized.role !== 'tool') {
    return;
  }

  messages.push(sanitized);
  if (messages.length > FINALIZATION_MAX_TRANSCRIPT_MESSAGES) {
    messages.splice(1, messages.length - FINALIZATION_MAX_TRANSCRIPT_MESSAGES);
  }
}

function summarizeScalarValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizePreviewText(value, 120);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function summarizeToolArguments(argumentsText?: string): string | undefined {
  if (!argumentsText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    for (const key of TOOL_ACTIVITY_ARGUMENT_KEYS) {
      const summary = summarizeScalarValue(parsed[key]);
      if (summary) {
        return summary;
      }
    }

    for (const value of Object.values(parsed)) {
      const summary = summarizeScalarValue(value);
      if (summary) {
        return summary;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function appendActivity(
  agent: ActiveSubAgent,
  kind: SubAgentActivityEntry['kind'],
  text: string | undefined,
): void {
  const normalized = normalizePreviewText(text, MAX_TOOL_RESULT_PREVIEW_CHARS);
  if (!normalized) {
    return;
  }

  const nextEntry: SubAgentActivityEntry = {
    timestamp: Date.now(),
    kind,
    text: normalized,
  };

  const previousEntries = agent.activityLog || [];
  const lastEntry = previousEntries[previousEntries.length - 1];
  const dedupedEntries =
    lastEntry?.kind === nextEntry.kind && lastEntry.text === nextEntry.text
      ? previousEntries
      : [...previousEntries, nextEntry];

  agent.activityLog = dedupedEntries.slice(-MAX_ACTIVITY_LOG_ENTRIES);
}

function updateAgentProgress(
  agent: ActiveSubAgent,
  changes: Partial<
    Pick<
      ActiveSubAgent,
      | 'currentActivity'
      | 'activeToolName'
      | 'activeToolStartedAt'
      | 'lastToolResultPreview'
      | 'launchState'
      | 'modelResponsePendingSince'
    >
  >,
  options?: {
    activityKind?: SubAgentActivityEntry['kind'];
    activityText?: string;
    announce?: boolean;
    markProgress?: boolean;
  },
): void {
  const now = Date.now();

  if (Object.prototype.hasOwnProperty.call(changes, 'currentActivity')) {
    agent.currentActivity = normalizePreviewText(
      changes.currentActivity,
      MAX_TOOL_RESULT_PREVIEW_CHARS,
    );
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'activeToolName')) {
    agent.activeToolName = changes.activeToolName;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'activeToolStartedAt')) {
    agent.activeToolStartedAt = changes.activeToolStartedAt;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'lastToolResultPreview')) {
    agent.lastToolResultPreview = normalizePreviewText(
      changes.lastToolResultPreview,
      MAX_TOOL_RESULT_PREVIEW_CHARS,
    );
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'modelResponsePendingSince')) {
    agent.modelResponsePendingSince =
      typeof changes.modelResponsePendingSince === 'number'
        ? changes.modelResponsePendingSince
        : undefined;
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'launchState')) {
    agent.launchState = changes.launchState;
    if (changes.launchState !== 'queued') {
      clearQueuedLaunchWatch(agent.sessionId);
    }
  }

  agent.updatedAt = now;
  if (options?.markProgress !== false) {
    agent.lastProgressAt = now;
  }

  if (options?.activityKind && options.activityText) {
    appendActivity(agent, options.activityKind, options.activityText);
  }

  if (options?.announce !== false) {
    scheduleProgressAnnouncement(agent);
  }
}

function markModelResponseObserved(agent: ActiveSubAgent): void {
  if (agent.modelResponsePendingSince == null) {
    return;
  }

  updateAgentProgress(
    agent,
    {
      modelResponsePendingSince: undefined,
      launchState: 'active',
    },
    {
      announce: false,
    },
  );
}

function buildToolResultFallback(params: {
  status: SubAgentResult['status'];
  lastNonEmptyContent: string;
  toolResultPreviews: Array<{ toolName: string; preview: string }>;
  toolsUsed: string[];
  iterations: number;
}): string | undefined {
  const sections: string[] = [];
  const baseText = normalizePreviewText(params.lastNonEmptyContent, OUTPUT_TRUNCATION);
  if (baseText) {
    sections.push(baseText);
  }

  const uniquePreviews = params.toolResultPreviews
    .map((entry) => ({
      toolName: entry.toolName,
      preview: normalizePreviewText(entry.preview, MAX_TOOL_RESULT_PREVIEW_CHARS),
    }))
    .filter((entry): entry is { toolName: string; preview: string } => Boolean(entry.preview));

  const dedupedPreviewMap = new Map<string, string>();
  for (const entry of uniquePreviews) {
    dedupedPreviewMap.set(
      `${entry.toolName}:${entry.preview}`,
      `${entry.toolName}: ${entry.preview}`,
    );
  }
  // Show all unique previews (up to 10) so tool-only sub-agents return
  // meaningful output instead of just listing tool names.
  const previewLines = Array.from(dedupedPreviewMap.values()).slice(-10);

  if (previewLines.length > 0) {
    const intro =
      params.status === 'cancelled'
        ? 'Latest verified worker findings before cancellation:'
        : params.status === 'timeout'
          ? 'Latest verified worker findings before timeout:'
          : params.status === 'error'
            ? 'Latest verified worker findings before the error:'
            : 'Latest verified worker findings:';
    sections.push([intro, ...previewLines.map((line) => `- ${line}`)].join('\n'));
  }

  if (sections.length === 0 && params.toolsUsed.length > 0) {
    const uniqueTools = [...new Set(params.toolsUsed)];
    sections.push(
      params.status === 'completed'
        ? `[Sub-agent completed ${params.iterations} tool iteration(s) using: ${uniqueTools.join(', ')}]`
        : `[Sub-agent ${params.status}: completed ${params.iterations} tool iteration(s) using: ${uniqueTools.join(', ')}]`,
    );
  }

  return sections.join('\n\n') || undefined;
}

function buildSubAgentFinalizationPrompt(params: {
  originalPrompt: string;
  transcriptMessages: Message[];
  toolResultPreviews: Array<{ toolName: string; preview: string }>;
  lastSubstantiveToolResult: string;
  toolsUsed: string[];
  iterations: number;
}): string {
  const transcript = params.transcriptMessages
    .slice(-FINALIZATION_MAX_TRANSCRIPT_MESSAGES)
    .map((message) => {
      if (message.role === 'user') {
        return `User task:\n${truncateTranscriptText(message.content, FINALIZATION_MESSAGE_CHAR_LIMIT) || '[No task details]'}`;
      }

      if (message.role === 'assistant') {
        const requestedTools = message.toolCalls?.length
          ? ` (requested tools: ${message.toolCalls.map((toolCall) => toolCall.name).join(', ')})`
          : '';
        const body =
          truncateTranscriptText(message.content, FINALIZATION_MESSAGE_CHAR_LIMIT) ||
          '[No visible assistant text]';
        return `Assistant${requestedTools}:\n${body}`;
      }

      const toolName = message.toolCalls?.[0]?.name || message.toolCallId || 'tool';
      const toolBody =
        truncateTranscriptText(message.content, FINALIZATION_TOOL_CONTENT_CHAR_LIMIT) ||
        '[No tool output]';
      return `Tool result - ${toolName}:\n${toolBody}`;
    })
    .join('\n\n');

  const previewLines = params.toolResultPreviews
    .slice(-10)
    .map(
      (entry) =>
        `- ${entry.toolName}: ${truncateTranscriptText(entry.preview, MAX_TOOL_RESULT_PREVIEW_CHARS) || entry.preview}`,
    )
    .join('\n');

  const detailedResult = truncateFinalizationText(params.lastSubstantiveToolResult, 4000);
  const toolSummary =
    params.toolsUsed.length > 0
      ? `Tool activity summary:\n- Iterations: ${params.iterations}\n- Tools used: ${[...new Set(params.toolsUsed)].join(', ')}`
      : undefined;

  return [
    'You are finalizing a completed worker run for a supervising agent.',
    `Original task:\n${truncateTranscriptText(params.originalPrompt, FINALIZATION_MESSAGE_CHAR_LIMIT) || '[No task provided]'}`,
    transcript ? `Execution transcript:\n${transcript}` : undefined,
    toolSummary,
    previewLines ? `Recent verified findings:\n${previewLines}` : undefined,
    detailedResult ? `Detailed result excerpt:\n${detailedResult}` : undefined,
    [
      'Write the final worker report now.',
      '- Include a completion_state field in plain text with one of: verified_success, blocked, incomplete.',
      '- For execution tasks, explicitly list actions_taken, artifacts_verified, external_runs_verified, and unverified_claims in concise bullets.',
      '- Start with the concrete outcome.',
      '- Include the key verified findings.',
      '- Mention any remaining blocker or uncertainty only if it still matters.',
      '- Do not ask for more tool calls.',
      '- Do not narrate the transcript; synthesize it into a useful answer for the supervisor.',
    ].join('\n'),
  ]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
}

function extractWorkerCompletionState(
  output: string,
): 'verified_success' | 'blocked' | 'incomplete' | undefined {
  const match = output.match(/completion_state\s*:\s*(verified_success|blocked|incomplete)\b/i);
  if (!match?.[1]) {
    return undefined;
  }

  const normalized = match[1].trim().toLowerCase();
  return normalized === 'verified_success' || normalized === 'blocked' || normalized === 'incomplete'
    ? normalized
    : undefined;
}

function extractStructuredWorkerField(output: string, fieldName: string): string | undefined {
  const match = output.match(new RegExp(`^${fieldName}\\s*:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() || undefined;
}

function hasNonEmptyStructuredWorkerField(output: string, fieldName: string): boolean {
  const value = extractStructuredWorkerField(output, fieldName);
  return !!value && value !== '[]';
}

function getUniqueNonEmptyLines(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildStructuredWorkerEvidenceLists(params: {
  toolsUsed: string[];
  toolResultPreviews: Array<{ toolName: string; preview: string }>;
}): {
  actionsTaken: string[];
  artifactsVerified: string[];
  externalRunsVerified: string[];
} {
  const operationalActionToolNames = new Set(
    params.toolsUsed.filter((toolName) => isOperationalEvidenceSourceName(toolName)),
  );
  for (const entry of params.toolResultPreviews) {
    if (
      isOperationalEvidenceSourceName(entry.toolName, entry.preview, {
        includeOpaqueDynamicToolResults: true,
      })
    ) {
      operationalActionToolNames.add(entry.toolName);
    }
  }

  const actionsTaken = getUniqueNonEmptyLines(
    Array.from(operationalActionToolNames).map((toolName) => `tool:${toolName}`),
  );
  const artifactsVerified = getUniqueNonEmptyLines(
    params.toolResultPreviews
      .filter((entry) =>
        isArtifactEvidenceSourceName(entry.toolName, entry.preview, {
          includeOpaqueDynamicToolResults: true,
        }),
      )
      .map((entry) => entry.preview),
  );
  const externalRunsVerified = getUniqueNonEmptyLines(
    params.toolResultPreviews
      .filter((entry) =>
        isExternalRunEvidenceSourceName(entry.toolName, entry.preview, {
          includeOpaqueDynamicToolResults: true,
        }),
      )
      .map((entry) => entry.preview),
  );

  return {
    actionsTaken,
    artifactsVerified,
    externalRunsVerified,
  };
}

function upsertStructuredWorkerField(output: string, fieldName: string, fieldValue: string): string {
  const pattern = new RegExp(`^${fieldName}\\s*:\\s*.*$`, 'im');
  const nextLine = `${fieldName}: ${fieldValue}`;
  if (pattern.test(output)) {
    return output.replace(pattern, nextLine);
  }

  return `${nextLine}\n${output}`;
}

function applyStructuredWorkerEvidenceEnvelope(params: {
  output: string;
  completionState: 'verified_success' | 'blocked' | 'incomplete';
  actionsTaken: string[];
  artifactsVerified: string[];
  externalRunsVerified: string[];
  unverifiedClaims: string[];
}): string {
  let nextOutput = params.output;
  nextOutput = upsertStructuredWorkerField(nextOutput, 'unverified_claims', JSON.stringify(params.unverifiedClaims));
  nextOutput = upsertStructuredWorkerField(nextOutput, 'external_runs_verified', JSON.stringify(params.externalRunsVerified));
  nextOutput = upsertStructuredWorkerField(nextOutput, 'artifacts_verified', JSON.stringify(params.artifactsVerified));
  nextOutput = upsertStructuredWorkerField(nextOutput, 'actions_taken', JSON.stringify(params.actionsTaken));
  nextOutput = upsertStructuredWorkerField(nextOutput, 'completion_state', params.completionState);
  return nextOutput;
}

function enforceExecutionWorkerOutputContract(params: {
  output: string;
  originalPrompt: string;
  toolsUsed: string[];
  toolResultPreviews: Array<{ toolName: string; preview: string }>;
  requireStructuredExecutionEvidence: boolean;
}): string {
  const normalizedOutput = normalizeFinalizationOutputText(params.output, OUTPUT_TRUNCATION);
  if (!normalizedOutput) {
    return params.output;
  }

  if (!params.requireStructuredExecutionEvidence) {
    return normalizedOutput;
  }

  const hasExecutionEvidence = hasOperationalEvidenceFromSources({
    toolsUsed: params.toolsUsed,
    resultPreviewEntries: params.toolResultPreviews.map((entry) => ({
      sourceName: entry.toolName,
      preview: entry.preview,
    })),
    resultPreviewSourceNames: params.toolResultPreviews.map((entry) => entry.toolName),
    includeOpaqueDynamicToolResults: true,
  });
  const structuredEvidenceLists = buildStructuredWorkerEvidenceLists(params);
  const completionState = extractWorkerCompletionState(normalizedOutput);
  const hasStructuredVerifiedEvidence =
    hasNonEmptyStructuredWorkerField(normalizedOutput, 'actions_taken') ||
    hasNonEmptyStructuredWorkerField(normalizedOutput, 'artifacts_verified') ||
    hasNonEmptyStructuredWorkerField(normalizedOutput, 'external_runs_verified');
  const hasStructuredUnverifiedClaims = hasNonEmptyStructuredWorkerField(normalizedOutput, 'unverified_claims');

  if (completionState === 'verified_success' && (!hasExecutionEvidence || hasStructuredUnverifiedClaims)) {
    return applyStructuredWorkerEvidenceEnvelope({
      output:
        !hasExecutionEvidence
          ? 'Blocker: verified_success requires matching operational evidence captured from internal tools or structured workflow evidence.'
          : 'Blocker: verified_success cannot coexist with non-empty unverified_claims.',
      completionState: 'blocked',
      actionsTaken: [],
      artifactsVerified: [],
      externalRunsVerified: [],
      unverifiedClaims: [
        !hasExecutionEvidence
          ? 'Worker output declared verified_success without matching operational evidence.'
          : 'Worker output declared verified_success while still reporting unverified_claims.',
      ],
    });
  }

  if (completionState === 'verified_success' && !hasStructuredVerifiedEvidence && hasExecutionEvidence) {
    return applyStructuredWorkerEvidenceEnvelope({
      output: normalizedOutput,
      completionState: 'verified_success',
      actionsTaken: structuredEvidenceLists.actionsTaken,
      artifactsVerified: structuredEvidenceLists.artifactsVerified,
      externalRunsVerified: structuredEvidenceLists.externalRunsVerified,
      unverifiedClaims: [],
    });
  }

  if (!completionState && hasExecutionEvidence) {
    return applyStructuredWorkerEvidenceEnvelope({
      output: normalizedOutput,
      completionState: 'verified_success',
      actionsTaken: structuredEvidenceLists.actionsTaken,
      artifactsVerified: structuredEvidenceLists.artifactsVerified,
      externalRunsVerified: structuredEvidenceLists.externalRunsVerified,
      unverifiedClaims: [],
    });
  }

  return normalizedOutput;
}

async function synthesizeSubAgentFinalAnswer(params: {
  provider: LlmProviderConfig;
  model: string;
  systemPrompt: string;
  originalPrompt: string;
  transcriptMessages: Message[];
  toolResultPreviews: Array<{ toolName: string; preview: string }>;
  lastSubstantiveToolResult: string;
  toolsUsed: string[];
  iterations: number;
  remainingBudgetMs: number;
  reportUsage?: (usage: TokenUsage) => void;
}): Promise<string | undefined> {
  if (params.remainingBudgetMs < FINALIZATION_MIN_REMAINING_MS) {
    return undefined;
  }

  const finalizationTimeoutMs = Math.min(
    FINALIZATION_TIMEOUT_CAP_MS,
    Math.max(FINALIZATION_MIN_REMAINING_MS, params.remainingBudgetMs),
  );
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, finalizationTimeoutMs);
  (timeoutTimer as any)?.unref?.();

  let output = '';
  let latestUsage: TokenUsage | undefined;
  let usageReported = false;
  const requestMessages = [
    {
      role: 'system',
      content: `${params.systemPrompt}\n\n## Finalization Pass\nTools are unavailable for this pass. Produce the final worker report for the supervising agent using only the verified transcript and tool results provided. Return the final answer directly.`,
    },
    {
      role: 'user',
      content: buildSubAgentFinalizationPrompt({
        originalPrompt: params.originalPrompt,
        transcriptMessages: params.transcriptMessages,
        toolResultPreviews: params.toolResultPreviews,
        lastSubstantiveToolResult: params.lastSubstantiveToolResult,
        toolsUsed: params.toolsUsed,
        iterations: params.iterations,
      }),
    },
  ];

  const mergeUsageSnapshot = (usage: TokenUsage): void => {
    const nextInputTokens = Math.max(latestUsage?.inputTokens ?? 0, usage.inputTokens ?? 0);
    const nextOutputTokens = Math.max(latestUsage?.outputTokens ?? 0, usage.outputTokens ?? 0);
    latestUsage = {
      model: usage.model || latestUsage?.model || params.model,
      inputTokens: nextInputTokens,
      outputTokens: nextOutputTokens,
      cacheReadTokens: Math.max(latestUsage?.cacheReadTokens ?? 0, usage.cacheReadTokens ?? 0),
      cacheWriteTokens: Math.max(latestUsage?.cacheWriteTokens ?? 0, usage.cacheWriteTokens ?? 0),
      totalTokens: Math.max(
        latestUsage?.totalTokens ?? 0,
        usage.totalTokens ?? 0,
        nextInputTokens + nextOutputTokens,
      ),
    };
  };

  const flushUsage = (): void => {
    if (usageReported || !params.reportUsage) {
      return;
    }

    if (!latestUsage) {
      const inputTokens = estimateMessageTokens(requestMessages);
      const outputTokens = estimateTokens(output);
      latestUsage = {
        model: params.model,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: inputTokens + outputTokens,
      };
    }

    usageReported = true;
    params.reportUsage(latestUsage);
  };

  try {
    const llm = new LlmService(params.provider);
    const stream = llm.streamMessage(requestMessages, {
      model: params.model,
      maxTokens: resolveFinalizationMaxTokens(params.model),
      signal: controller.signal,
    });

    for await (const event of stream) {
      if (event.type === 'token') {
        output += event.content || '';
      } else if (event.type === 'done' && !output && event.content) {
        output = event.content;
      } else if (event.type === 'usage' && event.usage) {
        mergeUsageSnapshot({
          model: params.model,
          inputTokens: event.usage.inputTokens ?? 0,
          outputTokens: event.usage.outputTokens ?? 0,
          cacheReadTokens: event.usage.cacheReadTokens ?? 0,
          cacheWriteTokens: event.usage.cacheWriteTokens ?? 0,
          totalTokens: event.usage.totalTokens,
        });
      }
    }
  } catch (error: unknown) {
    if (!controller.signal.aborted) {
      logger.devWarn(
        'Finalization pass failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    return undefined;
  } finally {
    clearTimeout(timeoutTimer);
    flushUsage();
  }

  return normalizeFinalizationOutputText(output, OUTPUT_TRUNCATION);
}

// ── Announce system ──────────────────────────────────────────────────────

export function onSubAgentEvent(
  listener: (agent: ActiveSubAgent, event: SubAgentAnnounceEvent) => void,
): () => void {
  announceListeners.add(listener);
  return () => {
    announceListeners.delete(listener);
  };
}

function clearScheduledProgressAnnouncement(sessionId: string): void {
  const timer = scheduledProgressAnnouncements.get(sessionId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  scheduledProgressAnnouncements.delete(sessionId);
}

function scheduleProgressAnnouncement(agent: ActiveSubAgent): void {
  if (announceListeners.size === 0 || scheduledProgressAnnouncements.has(agent.sessionId)) {
    return;
  }

  const timer = setTimeout(() => {
    scheduledProgressAnnouncements.delete(agent.sessionId);
    const latestSnapshot = activeSubAgents.get(agent.sessionId);
    if (!latestSnapshot || latestSnapshot.status !== 'running') {
      return;
    }

    announce(latestSnapshot, 'progress');
  }, PROGRESS_ANNOUNCE_INTERVAL_MS);
  (timer as any)?.unref?.();
  scheduledProgressAnnouncements.set(agent.sessionId, timer);
}

function announce(agent: ActiveSubAgent, event: SubAgentAnnounceEvent): void {
  if (event !== 'progress') {
    clearScheduledProgressAnnouncement(agent.sessionId);
  }

  const snapshot = cloneAgent(agent);
  for (const listener of announceListeners) {
    try {
      listener(snapshot, event);
    } catch {
      /* swallow listener errors */
    }
  }
}

// ── Persistence helpers ──────────────────────────────────────────────────

async function writeRegistrySnapshot(): Promise<void> {
  const entries = Array.from(activeSubAgents.values()).map((agent) =>
    sanitizePersistedAgentSnapshot(agent),
  );
  const serializedContexts = Object.fromEntries(
    Array.from(sessionContexts.entries())
      .filter(([sessionId]) => activeSubAgents.has(sessionId))
      .map(([sessionId, context]) => [
        sessionId,
        cloneSessionContext(context, { redactProviderSecrets: true }),
      ]),
  );

  await Promise.all([
    throttledAsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(entries)),
    throttledAsyncStorage.setItem(REGISTRY_CONTEXTS_KEY, JSON.stringify(serializedContexts)),
  ]);
}

async function flushPersistRegistryRequests(): Promise<void> {
  while (registryPersistRequested) {
    registryPersistRequested = false;
    await writeRegistrySnapshot();
  }
}

function enqueueRegistryPersist(): Promise<void> {
  registryPersistRequested = true;
  registryPersistChain = registryPersistChain
    .catch(() => undefined)
    .then(() => flushPersistRegistryRequests());
  return registryPersistChain;
}

function scheduleRegistryPersist(): void {
  registryPersistRequested = true;
  if (scheduledRegistryPersist) {
    return;
  }

  scheduledRegistryPersist = setTimeout(() => {
    scheduledRegistryPersist = undefined;
    void enqueueRegistryPersist().catch((error: unknown) => {
      logger.devWarn('background registry persist failed:', error);
    });
  }, REGISTRY_PERSIST_DEBOUNCE_MS);
  (scheduledRegistryPersist as any)?.unref?.();
}

async function persistRegistryNow(): Promise<void> {
  if (scheduledRegistryPersist) {
    clearTimeout(scheduledRegistryPersist);
    scheduledRegistryPersist = undefined;
  }

  await enqueueRegistryPersist();
  await Promise.all([
    flushPendingStorageWrites(REGISTRY_KEY),
    flushPendingStorageWrites(REGISTRY_CONTEXTS_KEY),
  ]);
}

async function loadRegistry(): Promise<void> {
  const [rawRegistry, rawContexts] = await Promise.all([
    throttledAsyncStorage.getItem(REGISTRY_KEY),
    throttledAsyncStorage.getItem(REGISTRY_CONTEXTS_KEY),
  ]);

  const loadedSessionIds = new Set<string>();

  if (rawRegistry) {
    try {
      const entries: ActiveSubAgent[] = JSON.parse(rawRegistry);
      for (const entry of entries) {
        if (!entry?.sessionId) {
          continue;
        }

        activeSubAgents.set(entry.sessionId, entry);
        loadedSessionIds.add(entry.sessionId);
      }
    } catch {
      /* corrupted data — ignore */
    }
  }

  if (!rawContexts) {
    return;
  }

  try {
    const parsed = JSON.parse(rawContexts) as Record<string, SubAgentSessionContext>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }

    for (const [sessionId, context] of Object.entries(parsed)) {
      if (!loadedSessionIds.has(sessionId) || !context || typeof context !== 'object') {
        continue;
      }

      try {
        sessionContexts.set(
          sessionId,
          cloneSessionContext(context, { redactProviderSecrets: true }),
        );
      } catch {
        // Ignore only the malformed entry; valid sibling contexts should still load.
      }
    }
  } catch {
    /* corrupted data — ignore */
  }
}

// ── Sandbox filter ───────────────────────────────────────────────────────

export function isToolAllowedBySandbox(
  toolName: string,
  policy: 'full' | 'safe-only' | 'inherit',
  options?: { explicitlyAllowedTools?: ReadonlySet<string> | null },
): boolean {
  if (policy === 'full') return true;
  if (policy === 'safe-only') {
    if (SAFE_ONLY_TOOLS.has(toolName)) {
      return true;
    }

    if (isDynamicToolName(toolName)) {
      return options?.explicitlyAllowedTools?.has(toolName) === true;
    }

    return false;
  }
  // 'inherit' — allow everything (parent's policy applies at the outer layer)
  return true;
}

async function prepareSubAgentSession(
  config: SubAgentConfig,
): Promise<PreparedSubAgentSession | SubAgentResult> {
  const depth = config.depth ?? 0;
  const normalizedPrompt = normalizeSubAgentPrompt(config.prompt);

  if (depth >= MAX_SPAWN_DEPTH) {
    return {
      sessionId: '',
      output: `Error: maximum sub-agent spawn depth (${MAX_SPAWN_DEPTH}) exceeded. Cannot spawn deeper.`,
      toolsUsed: [],
      iterations: 0,
      status: 'error',
      error: `Max spawn depth ${MAX_SPAWN_DEPTH} exceeded`,
      depth,
    };
  }

  if (!normalizedPrompt) {
    return {
      sessionId: '',
      output: 'Error: worker launch rejected because prompt is missing or empty.',
      toolsUsed: [],
      iterations: 0,
      status: 'error',
      error: 'Sub-agent prompt must be a non-empty string.',
      depth,
    };
  }

  const sessionId = `sub-${Date.now()}-${generateId()}`;
  const maxIterations = normalizeSubAgentMaxIterations(config.maxIterations);
  const timeoutMs = normalizeSubAgentTimeoutMs(config.timeoutMs);
  const sandboxPolicy = config.sandboxPolicy ?? 'inherit';
  const startedAt = Date.now();

  const subAgent: ActiveSubAgent = {
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
  };
  activeSubAgents.set(sessionId, subAgent);
  scheduleRegistryPersist();

  const agentLabel = subAgent.name ? `${subAgent.name} (${sessionId})` : sessionId;
  logger.debug(
    `Spawning ${agentLabel} at depth ${depth}, maxIter=${maxIterations}, timeout=${timeoutMs != null ? `${timeoutMs}ms` : 'none'}, sandbox=${sandboxPolicy}`,
  );

  if (config.announce !== false) {
    announce(subAgent, 'started');
  }

  return {
    sessionId,
    depth,
    maxIterations,
    timeoutMs,
    sandboxPolicy,
    subAgent,
  };
}

async function runPreparedSubAgent(
  prepared: PreparedSubAgentSession,
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<SubAgentResult> {
  const { sessionId, depth, maxIterations, timeoutMs, sandboxPolicy, subAgent } = prepared;

  const messages = buildInitialSubAgentMessages(config);
  const transcriptMessages: Message[] = messages.map((message) =>
    sanitizeTranscriptMessage(message),
  );
  const transcriptToolCalls = new Map<string, ToolCall>();
  const currentTaskPrompt = resolveCurrentTaskPrompt(
    messages,
    normalizeSubAgentPrompt(config.prompt) || '',
  );
  const runtimeToolAvailability = getRuntimeToolAvailabilityContext();
  const configuredPreferredTools = remapRuntimeUnavailableToolNames(
    normalizeConfiguredToolNames(config.tools),
    { context: runtimeToolAvailability },
  );
  const effectivePreferredTools = (() => {
    if (!configuredPreferredTools?.length) {
      return configuredPreferredTools;
    }

    if (sandboxPolicy !== 'safe-only') {
      return configuredPreferredTools;
    }

    const explicitlyAllowedTools = new Set(configuredPreferredTools);
    const filtered = configuredPreferredTools.filter((toolName) =>
      isToolAllowedBySandbox(toolName, sandboxPolicy, {
        explicitlyAllowedTools,
      }),
    );

    return filtered.length > 0 ? filtered : undefined;
  })();
  const explicitToolSelectionRejectedMessage =
    !!configuredPreferredTools?.length &&
    (!effectivePreferredTools || effectivePreferredTools.length === 0)
      ? sandboxPolicy === 'safe-only'
        ? 'Worker launch rejected because the requested tools are not allowed by the safe-only sandbox. Choose safe tools or relax the sandbox policy.'
        : 'Worker launch rejected because no usable worker tools remained after runtime remapping.'
      : undefined;
  const workspaceConversationId =
    config.workspaceConversationId?.trim() || config.parentConversationId;
  const recordParentConversationUsage = (
    usage: TokenUsage,
    source: 'sub-agent' | 'sub-agent-finalizer',
    options?: { recordSessionUsage?: boolean },
  ): void => {
    recordConversationUsageEvent({
      conversationId: config.parentConversationId,
      usage: {
        model: usage.model || config.model || provider.model,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        totalTokens: usage.totalTokens,
      },
      providerId: provider.id,
      source,
      sessionId,
      parentSessionId: config.parentSessionId,
      agentRunId: config.agentRunId,
      recordSessionUsage: options?.recordSessionUsage,
      emitLog: true,
    });
  };
  const checkpointSessionContext = (
    conversationSummary?: string,
    options?: { immediate?: boolean },
  ): void => {
    scheduleSessionContextCheckpoint(
      {
        sessionId,
        config,
        provider,
        allProviders,
        systemPrompt,
        conversationSummary: conversationSummary?.trim() || '',
        messages: transcriptMessages,
      },
      options,
    );
  };
  const persistSessionContextNow = (conversationSummary?: string): void => {
    clearPendingSessionContextCheckpoint(sessionId);
    clearSessionContextEviction(sessionId);
    storeSessionContext({
      sessionId,
      config,
      provider,
      allProviders,
      systemPrompt,
      conversationSummary: conversationSummary?.trim() || '',
      messages: transcriptMessages,
    });
    scheduleRegistryPersist();
  };

  let outputText = '';
  let lastNonEmptyContent = '';
  let finalNonEmptyContent = '';
  const toolsUsed: string[] = [];
  const toolResultPreviews: Array<{ toolName: string; preview: string }> = [];
  const requireStructuredExecutionEvidence = Boolean(config.agentRunId || config.workstreamId);
  // Track the last substantive tool result so tool-only sub-agents (e.g.
  // Claude tool_use with no text) can still produce meaningful output.
  let lastSubstantiveToolResult = '';
  let iterations = 0;
  let lastTokenHeartbeatAt = 0;
  // Build the sub-agent system prompt once so both the main worker loop and
  // any tool-less finalization pass share the same contract.
  const systemPrompt = buildSubAgentSystemPrompt(config, depth);

  checkpointSessionContext();
  // Slow providers can spend noticeable time before the first visible token or
  // tool event, so surface bootstrap progress instead of leaving the UI pinned
  // to the initial queued snapshot.
  updateAgentProgress(subAgent, {
    currentActivity: 'Bootstrapping worker',
    launchState: 'bootstrapping',
  });

  const trackToolCall = (
    toolCallLike: Partial<ToolCall> | undefined,
    fallbackStatus: ToolCall['status'],
  ): ToolCall => {
    const fallbackId = `${sessionId}-tool-${Math.max(iterations, 0)}-${fallbackStatus}`;
    const id =
      typeof toolCallLike?.id === 'string' && toolCallLike.id.trim().length > 0
        ? toolCallLike.id
        : fallbackId;
    const existing = transcriptToolCalls.get(id);
    const nextToolCall: ToolCall = {
      id,
      name:
        typeof toolCallLike?.name === 'string' && toolCallLike.name.trim().length > 0
          ? toolCallLike.name
          : existing?.name || 'tool',
      arguments:
        typeof toolCallLike?.arguments === 'string'
          ? toolCallLike.arguments
          : existing?.arguments || '{}',
      ...(toolCallLike?.raw
        ? { raw: cloneJsonLike(toolCallLike.raw) }
        : existing?.raw
          ? { raw: cloneJsonLike(existing.raw) }
          : {}),
      status: coerceToolCallStatus(toolCallLike?.status, fallbackStatus),
      startedAt: toolCallLike?.startedAt ?? existing?.startedAt,
      updatedAt: toolCallLike?.updatedAt ?? Date.now(),
      completedAt: toolCallLike?.completedAt ?? existing?.completedAt,
      progressText: toolCallLike?.progressText ?? existing?.progressText,
      result: typeof toolCallLike?.result === 'string' ? toolCallLike.result : existing?.result,
      error: typeof toolCallLike?.error === 'string' ? toolCallLike.error : existing?.error,
    };
    transcriptToolCalls.set(id, nextToolCall);
    return nextToolCall;
  };

  const resolveWorkerOutput = async (status: SubAgentResult['status']): Promise<string> => {
    if (finalNonEmptyContent) {
      return finalNonEmptyContent;
    }

    const directOutput =
      toolsUsed.length === 0 ? normalizeFinalizationOutputText(outputText) : undefined;
    if (directOutput) {
      return directOutput;
    }

    const hasToolEvidence =
      toolResultPreviews.length > 0 ||
      !!lastSubstantiveToolResult ||
      !!lastNonEmptyContent ||
      transcriptMessages.length > 1 ||
      transcriptMessages.some((message) => message.role === 'tool') ||
      transcriptMessages.some(
        (message) => message.role === 'assistant' && (message.toolCalls?.length || 0) > 0,
      );
    const shouldAttemptFinalization =
      status === 'completed'
        ? toolsUsed.length > 0
        : status !== 'cancelled' && toolsUsed.length > 0 && hasToolEvidence;
    if (shouldAttemptFinalization) {
      const remainingBudgetMs =
        timeoutMs == null
          ? FINALIZATION_TIMEOUT_CAP_MS
          : Math.max(0, timeoutMs - (Date.now() - subAgent.startedAt) - 250);
      updateAgentProgress(
        subAgent,
        {
          currentActivity: 'Finalizing verified findings',
          launchState: 'finalizing',
          activeToolName: undefined,
          activeToolStartedAt: undefined,
        },
        {
          activityKind: 'status',
          activityText: 'Finalizing verified findings',
        },
      );
      const finalizedOutput = await synthesizeSubAgentFinalAnswer({
        provider,
        model: config.model || provider.model,
        systemPrompt,
        originalPrompt: currentTaskPrompt,
        transcriptMessages,
        toolResultPreviews,
        lastSubstantiveToolResult,
        toolsUsed,
        iterations,
        remainingBudgetMs,
        reportUsage: (usage) => {
          recordParentConversationUsage(usage, 'sub-agent-finalizer', { recordSessionUsage: true });
        },
      });

      if (finalizedOutput) {
        const contractSafeOutput = enforceExecutionWorkerOutputContract({
          output: finalizedOutput,
          originalPrompt: currentTaskPrompt,
          toolsUsed,
          toolResultPreviews,
          requireStructuredExecutionEvidence,
        });
        appendTranscriptMessage(transcriptMessages, {
          id: generateId(),
          role: 'assistant',
          content: contractSafeOutput,
          timestamp: Date.now(),
        });
        appendActivity(subAgent, 'message', contractSafeOutput);
        return contractSafeOutput;
      }
    }

    if (lastNonEmptyContent) {
      return enforceExecutionWorkerOutputContract({
        output: lastNonEmptyContent,
        originalPrompt: currentTaskPrompt,
        toolsUsed,
        toolResultPreviews,
        requireStructuredExecutionEvidence,
      });
    }

    if (lastSubstantiveToolResult && !outputText.trim()) {
      return enforceExecutionWorkerOutputContract({
        output: lastSubstantiveToolResult,
        originalPrompt: currentTaskPrompt,
        toolsUsed,
        toolResultPreviews,
        requireStructuredExecutionEvidence,
      });
    }

    return enforceExecutionWorkerOutputContract({
      output:
        buildToolResultFallback({
        status,
        lastNonEmptyContent,
        toolResultPreviews,
        toolsUsed,
        iterations,
      }) || '',
      originalPrompt: currentTaskPrompt,
      toolsUsed,
      toolResultPreviews,
      requireStructuredExecutionEvidence,
    });
  };

  // Build tool filter: config.tools whitelist takes priority, then sandbox policy
  // Log warnings for unrecognized tool names (validated at filter time)
  const buildToolFilter = (): ((name: string) => boolean) | undefined => {
    const hasToolsWhitelist = !!effectivePreferredTools?.length;
    const hasSandboxRestriction = sandboxPolicy === 'safe-only';

    if (!hasToolsWhitelist && !hasSandboxRestriction) return undefined;

    const toolsSet = hasToolsWhitelist ? new Set(effectivePreferredTools) : null;
    return (name: string) => {
      const normalizedName = normalizeToolName(name);
      if (toolsSet && !toolsSet.has(normalizedName)) return false;
      if (
        hasSandboxRestriction &&
        !isToolAllowedBySandbox(normalizedName, sandboxPolicy, {
          explicitlyAllowedTools: toolsSet,
        })
      )
        return false;
      return true;
    };
  };

  const abortController = new AbortController();
  const runControl: ActiveSubAgentRunControl = { abortController };
  activeRunControls.set(sessionId, runControl);
  const timeoutTimer =
    timeoutMs != null
      ? setTimeout(() => {
          runControl.abortReason = 'timeout';
          abortController.abort();
        }, timeoutMs)
      : undefined;
  (timeoutTimer as any)?.unref?.();

  try {
    if (explicitToolSelectionRejectedMessage) {
      throw new Error(explicitToolSelectionRejectedMessage);
    }

    const workerModel = config.model || provider.model;
    await new Promise<void>((resolve, reject) => {
      runOrchestrator(
        {
          provider,
          model: workerModel,
          conversationId: sessionId,
          usageConversationId: config.parentConversationId,
          workspaceConversationId,
          workspaceReadFallbackConversationId: sessionId,
          systemPrompt,
          messages,
          maxTokens: resolveSubAgentMaxTokens(workerModel),
          signal: abortController,
          // Safe to keep enabled: the orchestrator only compacts at iteration
          // boundaries and now responds to real request-budget pressure.
          enableCompaction: true,
          enableFailover: true,
          linkUnderstandingEnabled: config.linkUnderstandingEnabled,
          mediaUnderstandingEnabled: config.mediaUnderstandingEnabled,
          allProviders,
          toolFilter: buildToolFilter(),
          preferredTools: effectivePreferredTools,
          responseBudgetProfile: 'sub-agent',
        },
        {
          onStateChange: (state) => {
            if (abortController.signal.aborted) {
              throw new Error('Sub-agent aborted');
            }

            if (subAgent.activeToolName) {
              return;
            }

            const responsePreview = buildSubAgentResponsePreview(outputText);
            if (responsePreview) {
              updateAgentProgress(subAgent, {
                currentActivity: responsePreview,
                launchState: 'active',
              });
              return;
            }

            const nextActivity =
              state === 'responding'
                ? toolsUsed.length > 0
                  ? 'Preparing next response'
                  : 'Preparing initial response'
                : state === 'thinking'
                  ? toolsUsed.length > 0
                    ? 'Planning next verified step'
                    : 'Planning task'
                  : undefined;

            if (!nextActivity) {
              return;
            }

            updateAgentProgress(subAgent, {
              currentActivity: nextActivity,
              launchState: 'active',
              ...(state === 'responding' ? { modelResponsePendingSince: Date.now() } : {}),
            });
          },
          onToolCallQueued: () => {
            markModelResponseObserved(subAgent);
          },
          onToken: (token) => {
            outputText += token;
            markModelResponseObserved(subAgent);
            const responsePreview = buildSubAgentResponsePreview(outputText);
            const now = Date.now();
            if (responsePreview && responsePreview !== subAgent.currentActivity) {
              lastTokenHeartbeatAt = now;
              updateAgentProgress(subAgent, {
                currentActivity: responsePreview,
                launchState: 'active',
              });
              return;
            }

            if (now - lastTokenHeartbeatAt >= 1500) {
              lastTokenHeartbeatAt = now;
              updateAgentProgress(
                subAgent,
                {
                  launchState: 'active',
                },
                {
                  announce: false,
                },
              );
            }
          },
          onReasoning: () => {
            markModelResponseObserved(subAgent);
            if (buildSubAgentResponsePreview(outputText)) {
              const now = Date.now();
              if (now - lastTokenHeartbeatAt >= 1500) {
                lastTokenHeartbeatAt = now;
                updateAgentProgress(
                  subAgent,
                  {
                    launchState: 'active',
                  },
                  {
                    announce: false,
                  },
                );
              }
              return;
            }
            const now = Date.now();
            if (now - lastTokenHeartbeatAt >= 1500) {
              lastTokenHeartbeatAt = now;
              updateAgentProgress(
                subAgent,
                {
                  currentActivity:
                    toolsUsed.length > 0
                      ? 'Reasoning about tool results'
                      : 'Reasoning about the task',
                  launchState: 'active',
                },
                {
                  announce: false,
                },
              );
            }
          },
          onAssistantStreamReset: () => {
            outputText = '';
            updateAgentProgress(
              subAgent,
              {
                currentActivity:
                  toolsUsed.length > 0 ? 'Preparing next response' : 'Preparing initial response',
                launchState: 'active',
              },
              {
                announce: false,
                markProgress: false,
              },
            );
          },
          onToolCallStart: (tc) => {
            if (abortController.signal.aborted) {
              return;
            }
            markModelResponseObserved(subAgent);
            finalNonEmptyContent = '';
            trackToolCall(tc, 'running');
            toolsUsed.push(tc.name);
            iterations++;
            const argumentSummary = summarizeToolArguments(tc.arguments);
            const activityText = argumentSummary
              ? `Using ${tc.name}: ${argumentSummary}`
              : `Using ${tc.name}`;
            updateAgentProgress(
              subAgent,
              {
                currentActivity: activityText,
                launchState: 'active',
                activeToolName: tc.name,
                activeToolStartedAt: Date.now(),
              },
              {
                activityKind: 'tool',
                activityText,
              },
            );
            if (iterations >= maxIterations) {
              runControl.abortReason = 'max-iterations';
              abortController.abort();
            }
          },
          onToolCallComplete: (toolCall) => {
            recordImageToolConversationUsage({
              conversationId: config.parentConversationId,
              toolCall,
              providerId: provider.id,
              source: 'sub-agent',
              sessionId,
              parentSessionId: config.parentSessionId,
              agentRunId: config.agentRunId,
              emitLog: true,
            });
            trackToolCall(
              toolCall,
              coerceToolCallStatus(
                toolCall?.status,
                toolCall?.status === 'failed' ? 'failed' : 'completed',
              ),
            );
            const completedToolName =
              toolCall?.name ||
              subAgent.activeToolName ||
              toolsUsed[toolsUsed.length - 1] ||
              'tool';
            const preview = summarizeFinalizationToolResultPreview(toolCall?.result);
            if (preview) {
              toolResultPreviews.push({ toolName: completedToolName, preview });
            }

            if (toolCall?.result && toolCall.status !== 'failed') {
              const resultText = typeof toolCall.result === 'string' ? toolCall.result.trim() : '';
              if (resultText.length > 30) {
                lastSubstantiveToolResult =
                  normalizeFinalizationOutputText(resultText) || lastSubstantiveToolResult;
              }
            }

            updateAgentProgress(
              subAgent,
              {
                currentActivity: preview
                  ? `Latest result from ${completedToolName}: ${preview}`
                  : toolCall?.status === 'failed'
                    ? `Tool ${completedToolName} failed`
                    : `Completed ${completedToolName}`,
                launchState: 'active',
                activeToolName: undefined,
                activeToolStartedAt: undefined,
                lastToolResultPreview: preview,
              },
              {
                activityKind: toolCall?.status === 'failed' ? 'status' : 'result',
                activityText: preview
                  ? `${completedToolName}: ${preview}`
                  : toolCall?.status === 'failed'
                    ? `Tool ${completedToolName} failed`
                    : `Completed ${completedToolName}`,
              },
            );
          },
          onAssistantMessage: (content, toolCalls, providerReplay, assistantMetadata) => {
            markModelResponseObserved(subAgent);
            const normalizedContent = normalizeFinalizationOutputText(content);
            const trackedToolCalls = toolCalls?.map((toolCall) =>
              trackToolCall(toolCall, 'pending'),
            );
            if (normalizedContent || trackedToolCalls?.length) {
              appendTranscriptMessage(transcriptMessages, {
                id: generateId(),
                role: 'assistant',
                content: normalizedContent || '',
                timestamp: Date.now(),
                ...(trackedToolCalls?.length ? { toolCalls: trackedToolCalls } : {}),
                ...(providerReplay ? { providerReplay: cloneJsonLike(providerReplay) } : {}),
                ...(assistantMetadata ? { assistantMetadata: { ...assistantMetadata } } : {}),
              });
              persistSessionContextNow(
                lastNonEmptyContent || finalNonEmptyContent || normalizedContent,
              );
            }
            if (normalizedContent) {
              outputText = normalizedContent;
              lastNonEmptyContent = normalizedContent;
              if (!toolCalls?.length && assistantMetadata?.completionStatus !== 'incomplete') {
                finalNonEmptyContent = normalizedContent;
              }
              const responsePreview = buildSubAgentResponsePreview(normalizedContent);
              updateAgentProgress(
                subAgent,
                {
                  currentActivity: responsePreview || normalizedContent,
                  launchState: 'active',
                },
                {
                  activityKind: 'message',
                  activityText: normalizedContent,
                },
              );
            }
          },
          onToolMessage: (toolCallId, result) => {
            appendTranscriptMessage(transcriptMessages, {
              id: generateId(),
              role: 'tool',
              content: result,
              toolCallId,
              timestamp: Date.now(),
              ...(transcriptToolCalls.has(toolCallId)
                ? { toolCalls: [transcriptToolCalls.get(toolCallId)!] }
                : {}),
              ...(typeof result === 'string' && /^Error:/i.test(result) ? { isError: true } : {}),
            });
            refreshSubAgentArtifacts(subAgent, transcriptMessages);
            checkpointSessionContext(lastNonEmptyContent || finalNonEmptyContent);
          },
          onError: (error) => {
            reject(error);
          },
          onUsage: (usage) => {
            recordParentConversationUsage(usage, 'sub-agent');
          },
          onDone: () => {
            resolve();
          },
        },
      ).catch(reject);
    });

    // When all LLM iterations are tool-only (e.g. Claude tool_use without text),
    // onToken never fires and onAssistantMessage receives empty content, so
    // outputText stays blank.  Fall back to the last non-empty content from an
    // earlier iteration, the last substantive tool result, or synthesize a
    // summary from tool usage.
    outputText = await resolveWorkerOutput('completed');

    // Truncate output to avoid memory bloat
    const truncatedOutput =
      outputText.length > OUTPUT_TRUNCATION
        ? outputText.slice(0, OUTPUT_TRUNCATION) + '\n\n[Output truncated]'
        : outputText;

    refreshSubAgentArtifacts(subAgent, transcriptMessages);
    subAgent.status = 'completed';
    subAgent.output = truncatedOutput;
    subAgent.toolsUsed = [...new Set(toolsUsed)];
    subAgent.iterations = iterations;
    subAgent.launchState = 'terminal';
    subAgent.modelResponsePendingSince = undefined;
    subAgent.currentActivity = undefined;
    subAgent.activeToolName = undefined;
    subAgent.activeToolStartedAt = undefined;
    subAgent.updatedAt = Date.now();

    // Store bounded session context for continuity in sessions_send.
    scheduleSessionContextCheckpoint(
      {
        sessionId,
        config,
        provider,
        allProviders,
        systemPrompt,
        conversationSummary: truncatedOutput,
        messages: transcriptMessages,
      },
      { immediate: true },
    );
    const persistOutcome = await persistRegistryBestEffort(
      'Persisting completed worker state failed',
    );
    scheduleSessionContextEvictionWhenDurable(sessionId, persistOutcome);

    if (config.announce !== false) {
      announce(subAgent, 'completed');
    }

    return {
      sessionId,
      output: truncatedOutput,
      toolsUsed: [...new Set(toolsUsed)],
      iterations,
      status: 'completed',
      depth: depth + 1,
      ...(subAgent.artifacts?.length ? { artifacts: cloneAttachments(subAgent.artifacts) } : {}),
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const runControl = activeRunControls.get(sessionId);
    const abortReason = runControl?.abortReason;
    const isCancelled =
      abortReason === 'cancelled' ||
      (typeof runControl?.cancelReason === 'string' && runControl.cancelReason.trim().length > 0);
    const isTimeout =
      abortReason === 'timeout' ||
      (!isCancelled &&
        !abortReason &&
        ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted));
    const isIterationLimit = abortReason === 'max-iterations';
    const status = isCancelled ? 'cancelled' : isTimeout ? 'timeout' : 'error';
    const terminalMessage = isCancelled
      ? runControl?.cancelReason || 'Cancelled by supervisor.'
      : isTimeout
        ? 'Worker reached its configured deadline before completion.'
        : isIterationLimit
          ? `Worker reached maxIterations (${maxIterations}) before completion.`
          : `Worker failed: ${errMsg}`;
    const errorMessage =
      status === 'cancelled' ? undefined : isTimeout || isIterationLimit ? terminalMessage : errMsg;

    outputText = await resolveWorkerOutput(status);

    const truncatedOutput =
      outputText.length > OUTPUT_TRUNCATION
        ? outputText.slice(0, OUTPUT_TRUNCATION) + '\n\n[Output truncated]'
        : outputText;

    refreshSubAgentArtifacts(subAgent, transcriptMessages);
    subAgent.status = status;
    subAgent.output = truncatedOutput || terminalMessage;
    subAgent.toolsUsed = [...new Set(toolsUsed)];
    subAgent.iterations = iterations;
    subAgent.launchState = 'terminal';
    subAgent.modelResponsePendingSince = undefined;
    subAgent.currentActivity = normalizePreviewText(terminalMessage, MAX_TOOL_RESULT_PREVIEW_CHARS);
    subAgent.activeToolName = undefined;
    subAgent.activeToolStartedAt = undefined;
    subAgent.updatedAt = Date.now();
    appendActivity(subAgent, 'status', terminalMessage);
    scheduleSessionContextCheckpoint(
      {
        sessionId,
        config,
        provider,
        allProviders,
        systemPrompt,
        conversationSummary: truncatedOutput || terminalMessage,
        messages: transcriptMessages,
      },
      { immediate: true },
    );
    const persistOutcome = await persistRegistryBestEffort(
      'Persisting terminal worker state failed',
    );
    scheduleSessionContextEvictionWhenDurable(sessionId, persistOutcome);

    if (config.announce !== false) {
      announce(
        subAgent,
        status === 'cancelled' ? 'cancelled' : status === 'timeout' ? 'timeout' : 'error',
      );
    }

    return {
      sessionId,
      output: truncatedOutput || terminalMessage,
      toolsUsed: [...new Set(toolsUsed)],
      iterations,
      status,
      error: errorMessage,
      depth: depth + 1,
      ...(subAgent.artifacts?.length ? { artifacts: cloneAttachments(subAgent.artifacts) } : {}),
    };
  } finally {
    activeRunControls.delete(sessionId);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
  }
}

function buildRecoveredTerminalSnapshotMap(
  conversations?: Conversation[],
): Map<string, SubAgentSnapshot> {
  const recoveredSnapshots = new Map<string, SubAgentSnapshot>();

  for (const conversation of conversations ?? []) {
    for (const message of conversation.messages ?? []) {
      const snapshot = message.subAgentEvent?.snapshot;
      if (!snapshot || !isTerminalSubAgentStatus(snapshot.status)) {
        continue;
      }

      const existing = recoveredSnapshots.get(snapshot.sessionId);
      if (!existing || snapshot.updatedAt >= existing.updatedAt) {
        recoveredSnapshots.set(snapshot.sessionId, cloneSubAgentSnapshot(snapshot));
      }
    }
  }

  return recoveredSnapshots;
}

function applyRecoveredTerminalSnapshot(agent: ActiveSubAgent, snapshot: SubAgentSnapshot): void {
  agent.parentConversationId = snapshot.parentConversationId;
  agent.parentSessionId = snapshot.parentSessionId;
  agent.agentRunId = snapshot.agentRunId;
  agent.name = snapshot.name;
  agent.depth = snapshot.depth;
  agent.startedAt = snapshot.startedAt;
  agent.updatedAt = Math.max(agent.updatedAt, snapshot.updatedAt);
  agent.deadlineAt = snapshot.deadlineAt;
  agent.status = snapshot.status;
  agent.sandboxPolicy = snapshot.sandboxPolicy;
  agent.launchState = snapshot.launchState ?? agent.launchState;
  agent.output = snapshot.output ?? agent.output;
  agent.toolsUsed = snapshot.toolsUsed ? [...snapshot.toolsUsed] : agent.toolsUsed;
  agent.artifacts = snapshot.artifacts ? cloneAttachments(snapshot.artifacts) : agent.artifacts;
  agent.iterations = snapshot.iterations ?? agent.iterations;
  agent.lastProgressAt = snapshot.lastProgressAt ?? agent.lastProgressAt;
  agent.modelResponsePendingSince =
    snapshot.modelResponsePendingSince ?? agent.modelResponsePendingSince;
  agent.currentActivity = snapshot.currentActivity;
  agent.activeToolName = snapshot.activeToolName;
  agent.activeToolStartedAt = snapshot.activeToolStartedAt;
  agent.lastToolResultPreview = snapshot.lastToolResultPreview ?? agent.lastToolResultPreview;
  agent.activityLog = snapshot.activityLog
    ? snapshot.activityLog.map((entry) => ({ ...entry }))
    : agent.activityLog;
}

function interruptRecoveredRunningAgent(agent: ActiveSubAgent, now: number): void {
  const interruptionMessage = 'Worker was interrupted because the app restarted before completion.';
  const existingOutput = normalizeFinalizationOutputText(agent.output);

  agent.status = 'error';
  agent.launchState = 'terminal';
  agent.output = existingOutput?.includes(interruptionMessage)
    ? existingOutput
    : existingOutput
      ? `${existingOutput}\n\n[${interruptionMessage}]`
      : interruptionMessage;
  agent.modelResponsePendingSince = undefined;
  agent.currentActivity = interruptionMessage;
  agent.activeToolName = undefined;
  agent.activeToolStartedAt = undefined;
  agent.deadlineAt = undefined;
  agent.updatedAt = now;
  appendActivity(agent, 'status', interruptionMessage);
}

function buildResultFromSnapshot(agent: ActiveSubAgent): SubAgentResult {
  const output = agent.output || '';
  const status = agent.status === 'running' ? 'cancelled' : agent.status;
  return {
    sessionId: agent.sessionId,
    output,
    toolsUsed: agent.toolsUsed ? [...new Set(agent.toolsUsed)] : [],
    iterations: agent.iterations || 0,
    status,
    ...(status === 'error' && output ? { error: output } : {}),
    depth: agent.depth + 1,
    ...(agent.artifacts?.length ? { artifacts: cloneAttachments(agent.artifacts) } : {}),
  };
}

function trackSubAgentResultPromise(
  sessionId: string,
  resultPromise: Promise<SubAgentResult>,
): Promise<SubAgentResult> {
  activeResultPromises.set(sessionId, resultPromise);
  void resultPromise.finally(() => {
    if (activeResultPromises.get(sessionId) === resultPromise) {
      activeResultPromises.delete(sessionId);
    }
  });
  return resultPromise;
}

export async function waitForSubAgentResultPromise(
  resultPromise: Promise<SubAgentResult>,
  waitTimeoutMs?: number,
): Promise<SubAgentResult | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise =
    waitTimeoutMs == null
      ? undefined
      : new Promise<null>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(null), waitTimeoutMs);
          (timeoutHandle as any)?.unref?.();
        });

  try {
    return timeoutPromise
      ? await Promise.race([resultPromise, timeoutPromise])
      : await resultPromise;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function waitForTerminalSubAgentSnapshot(
  sessionId: string,
  waitTimeoutMs?: number,
): Promise<SubAgentResult | null> {
  const startedAt = Date.now();

  while (true) {
    const agent = activeSubAgents.get(sessionId);
    if (!agent) {
      throw new Error(`session not found: ${sessionId}`);
    }

    if (agent.status !== 'running') {
      return buildResultFromSnapshot(agent);
    }

    if (waitTimeoutMs != null) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= waitTimeoutMs) {
        return null;
      }

      await new Promise<void>((resolve) => {
        const handle = setTimeout(resolve, Math.max(1, Math.min(250, waitTimeoutMs - elapsedMs)));
        (handle as any)?.unref?.();
      });
      continue;
    }

    await new Promise<void>((resolve) => {
      const handle = setTimeout(resolve, 250);
      (handle as any)?.unref?.();
    });
  }
}

export async function waitForSubAgentCompletion(
  sessionId: string,
  waitTimeoutMs?: number,
): Promise<SubAgentResult | null> {
  const agent = activeSubAgents.get(sessionId);
  if (!agent) {
    throw new Error(`session not found: ${sessionId}`);
  }

  if (agent.status !== 'running') {
    return buildResultFromSnapshot(agent);
  }

  const resultPromise = activeResultPromises.get(sessionId);
  if (resultPromise) {
    try {
      return await waitForSubAgentResultPromise(resultPromise, waitTimeoutMs);
    } catch (error: unknown) {
      handleUnexpectedBackgroundSubAgentFailure(sessionId, error, false);
      const latestAgent = activeSubAgents.get(sessionId);
      if (latestAgent && latestAgent.status !== 'running') {
        return buildResultFromSnapshot(latestAgent);
      }
      throw error;
    }
  }

  return waitForTerminalSubAgentSnapshot(sessionId, waitTimeoutMs);
}

function schedulePreparedSubAgentRun(
  prepared: PreparedSubAgentSession,
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<SubAgentResult> {
  scheduleQueuedLaunchWatch(prepared.subAgent, config.announce !== false);

  return new Promise<SubAgentResult>((resolve, reject) => {
    const launchHandle = setTimeout(() => {
      scheduledSubAgentLaunches.delete(prepared.sessionId);

      if (prepared.subAgent.status !== 'running') {
        resolve(buildResultFromSnapshot(prepared.subAgent));
        return;
      }

      void runPreparedSubAgent(prepared, config, provider, allProviders).then(resolve, reject);
    }, 0);
    (launchHandle as any)?.unref?.();

    scheduledSubAgentLaunches.set(prepared.sessionId, {
      handle: launchHandle,
      resolve,
      reject,
    });
  });
}

function handleUnexpectedBackgroundSubAgentFailure(
  sessionId: string,
  error: unknown,
  announceFailure: boolean,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.devWarn('Background worker promise rejected:', errorMessage);

  const agent = activeSubAgents.get(sessionId);
  if (!agent || agent.status !== 'running') {
    return;
  }

  const terminalMessage = `Worker failed before a final result could be persisted: ${errorMessage}`;
  const existingOutput = normalizeFinalizationOutputText(agent.output);

  agent.status = 'error';
  agent.launchState = 'terminal';
  agent.output = existingOutput ? `${existingOutput}\n\n[${terminalMessage}]` : terminalMessage;
  agent.currentActivity = normalizePreviewText(terminalMessage, MAX_TOOL_RESULT_PREVIEW_CHARS);
  agent.activeToolName = undefined;
  agent.activeToolStartedAt = undefined;
  agent.deadlineAt = undefined;
  agent.updatedAt = Date.now();
  appendActivity(agent, 'status', terminalMessage);

  activeRunControls.delete(sessionId);
  void persistRegistryNow()
    .then(() => {
      const latestAgent = activeSubAgents.get(sessionId);
      if (latestAgent && latestAgent.status !== 'running') {
        scheduleSessionContextEviction(sessionId);
      }
    })
    .catch((persistError) => {
      logger.devWarn(
        'unexpected background failure persist failed:',
        persistError instanceof Error ? persistError.message : String(persistError),
      );
    });

  if (announceFailure) {
    announce(agent, 'error');
  }
}

export function observeBackgroundSubAgentResult(
  started: { sessionId: string; resultPromise: Promise<SubAgentResult> },
  options?: { announce?: boolean },
): void {
  void started.resultPromise.catch((error) => {
    handleUnexpectedBackgroundSubAgentFailure(
      started.sessionId,
      error,
      options?.announce !== false,
    );
  });
}

// ── Sub-agent launch helpers ─────────────────────────────────────────────

export async function startSubAgent(
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<{
  sessionId: string;
  status: 'running';
  depth: number;
  resultPromise: Promise<SubAgentResult>;
}> {
  const hydratedProvider = await hydrateProviderForRequest(provider);
  assertProviderReadyForRequest(
    hydratedProvider,
    provider.name ? `Sub-agent provider "${provider.name}"` : 'Sub-agent provider',
  );

  const prepared = await prepareSubAgentSession(config);
  if ('status' in prepared) {
    throw new Error(prepared.error || prepared.output || 'sub-agent-launch-failed');
  }

  const resultPromise = trackSubAgentResultPromise(
    prepared.sessionId,
    schedulePreparedSubAgentRun(prepared, config, hydratedProvider, allProviders),
  );

  await persistPreparedSubAgentLaunchStateBestEffort(
    prepared,
    config,
    hydratedProvider,
    allProviders,
  );

  return {
    sessionId: prepared.sessionId,
    status: 'running',
    depth: prepared.depth + 1,
    resultPromise,
  };
}

export async function spawnSubAgent(
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<SubAgentResult> {
  const hydratedProvider = await hydrateProviderForRequest(provider);
  assertProviderReadyForRequest(
    hydratedProvider,
    provider.name ? `Sub-agent provider "${provider.name}"` : 'Sub-agent provider',
  );

  // Blocking convenience wrapper. Use startSubAgent or launchSubAgent when
  // the caller needs the worker to continue in the background.
  const prepared = await prepareSubAgentSession(config);
  if ('status' in prepared) {
    return prepared;
  }

  await persistPreparedSubAgentLaunchStateBestEffort(
    prepared,
    config,
    hydratedProvider,
    allProviders,
  );

  return runPreparedSubAgent(prepared, config, hydratedProvider, allProviders);
}

export async function launchSubAgent(
  config: SubAgentConfig,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
): Promise<{ sessionId: string; status: 'running'; depth: number }> {
  const started = await startSubAgent(config, provider, allProviders);
  observeBackgroundSubAgentResult(started, { announce: config.announce !== false });

  return {
    sessionId: started.sessionId,
    status: 'running',
    depth: started.depth,
  };
}

export function cancelSubAgent(sessionId: string, reason?: string): ActiveSubAgent | undefined {
  const agent = activeSubAgents.get(sessionId);
  if (!agent) {
    return undefined;
  }

  if (agent.status !== 'running') {
    return cloneAgent(agent);
  }

  const normalizedReason =
    normalizePreviewText(reason, MAX_TOOL_RESULT_PREVIEW_CHARS) ||
    'Cancelled by supervisor before completion.';
  const runControl = activeRunControls.get(sessionId);

  updateAgentProgress(
    agent,
    {
      currentActivity: normalizedReason,
      modelResponsePendingSince: undefined,
    },
    {
      activityKind: 'status',
      activityText: normalizedReason,
    },
  );

  if (runControl) {
    runControl.abortReason = 'cancelled';
    runControl.cancelReason = normalizedReason;
    runControl.abortController.abort();
  } else {
    clearQueuedLaunchWatch(sessionId);
    agent.status = 'cancelled';
    agent.launchState = 'terminal';
    agent.output = normalizedReason;
    agent.modelResponsePendingSince = undefined;
    agent.currentActivity = normalizedReason;
    agent.activeToolName = undefined;
    agent.activeToolStartedAt = undefined;
    agent.updatedAt = Date.now();
    appendActivity(agent, 'status', normalizedReason);
    scheduleRegistryPersist();
    resolveScheduledLaunchWithSnapshot(sessionId);
    announce(agent, 'cancelled');
  }

  return cloneAgent(agent);
}

// ── Sub-agent management ─────────────────────────────────────────────────

export function listActiveSubAgents(): ActiveSubAgent[] {
  return Array.from(activeSubAgents.values());
}

export function getSubAgent(sessionId: string): ActiveSubAgent | undefined {
  return activeSubAgents.get(sessionId);
}

/** Return the stored session context for continuity in sessions_send. */
export function getSessionContext(sessionId: string): SubAgentSessionContext | undefined {
  flushSessionContextCheckpoint(sessionId);
  const context = sessionContexts.get(sessionId);
  if (!context) {
    return undefined;
  }

  return cloneSessionContext(context);
}

export function getSubAgentsByParent(parentConversationId: string): ActiveSubAgent[] {
  return Array.from(activeSubAgents.values()).filter(
    (a) => a.parentConversationId === parentConversationId,
  );
}

export function cleanupSubAgents(): void {
  const now = Date.now();
  let didRemove = false;

  for (const [id, agent] of activeSubAgents) {
    if (agent.status !== 'running' && now - agent.updatedAt > TERMINAL_SUB_AGENT_RETENTION_MS) {
      clearScheduledProgressAnnouncement(id);
      clearQueuedLaunchWatch(id);
      clearSessionContextEviction(id);
      clearPendingSessionContextCheckpoint(id);
      activeSubAgents.delete(id);
      sessionContexts.delete(id);
      didRemove = true;
    }
  }

  if (didRemove) {
    scheduleRegistryPersist();
  }
}

/**
 * Reconcile persisted sub-agents on app startup.
 * Restores terminal transcript snapshots first, then interrupts any workers
 * that were still running when the previous app session ended.
 */
export async function detectOrphans(conversations?: Conversation[]): Promise<number> {
  await loadRegistry();
  let orphanCount = 0;
  let restoredTerminalCount = 0;
  const now = Date.now();
  const recoveredTerminalSnapshots = buildRecoveredTerminalSnapshotMap(conversations);

  for (const [, agent] of activeSubAgents) {
    const recoveredSnapshot = recoveredTerminalSnapshots.get(agent.sessionId);
    if (recoveredSnapshot) {
      const shouldAdoptRecoveredSnapshot =
        agent.status !== recoveredSnapshot.status ||
        agent.updatedAt < recoveredSnapshot.updatedAt ||
        (!agent.output && !!recoveredSnapshot.output) ||
        (agent.toolsUsed?.length ?? 0) < (recoveredSnapshot.toolsUsed?.length ?? 0) ||
        (agent.activityLog?.length ?? 0) < (recoveredSnapshot.activityLog?.length ?? 0);

      if (shouldAdoptRecoveredSnapshot) {
        applyRecoveredTerminalSnapshot(agent, recoveredSnapshot);
        restoredTerminalCount += 1;
      }
      continue;
    }

    if (agent.status === 'running') {
      interruptRecoveredRunningAgent(agent, now);
      orphanCount++;
    }
  }

  if (restoredTerminalCount > 0 || orphanCount > 0) {
    await persistRegistryNow();
  }
  return orphanCount;
}

/**
 * Initialize the sub-agent registry from persisted storage.
 * Should be called once on app startup.
 */
export async function initSubAgentRegistry(conversations?: Conversation[]): Promise<void> {
  await detectOrphans(conversations);
  cleanupSubAgents();
}

/** Visible for testing only. */
export async function __resetSubAgentStateForTests(): Promise<void> {
  if (scheduledRegistryPersist) {
    clearTimeout(scheduledRegistryPersist);
    scheduledRegistryPersist = undefined;
  }

  registryPersistRequested = false;
  registryPersistChain = Promise.resolve();

  for (const sessionId of Array.from(sessionContextEvictionTimers.keys())) {
    clearSessionContextEviction(sessionId);
  }

  for (const sessionId of Array.from(scheduledSessionContextCheckpoints.keys())) {
    clearScheduledSessionContextCheckpoint(sessionId);
  }

  for (const sessionId of Array.from(scheduledProgressAnnouncements.keys())) {
    clearScheduledProgressAnnouncement(sessionId);
  }

  for (const sessionId of Array.from(queuedLaunchWatches.keys())) {
    clearQueuedLaunchWatch(sessionId);
  }

  for (const scheduledLaunch of Array.from(scheduledSubAgentLaunches.values())) {
    clearTimeout(scheduledLaunch.handle);
  }

  pendingSessionContextCheckpoints.clear();
  activeSubAgents.clear();
  activeRunControls.clear();
  activeResultPromises.clear();
  scheduledSubAgentLaunches.clear();
  queuedLaunchWatches.clear();
  sessionContexts.clear();
  sessionContextEvictionTimers.clear();
  scheduledSessionContextCheckpoints.clear();
  scheduledProgressAnnouncements.clear();
  await Promise.all([
    throttledAsyncStorage.removeItem(REGISTRY_KEY),
    throttledAsyncStorage.removeItem(REGISTRY_CONTEXTS_KEY),
  ]);
}
