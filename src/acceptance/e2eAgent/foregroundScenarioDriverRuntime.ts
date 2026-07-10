import { resolveConversationPersonaForMode } from '../../engine/graph/conversation/modeTransitions';
import { executeForegroundConversationRun } from '../../engine/graph/foregroundRun/execution';
import { resolveForegroundConversationExecutionContext } from '../../engine/graph/foregroundRun/executionContext';
import type {
  ExecuteForegroundConversationRunParams,
  ForegroundStreamingDraft,
} from '../../engine/graph/foregroundRun/executionTypes';
import type { ResumeAgentRun } from '../../engine/graph/foregroundRun/contracts';
import { createForegroundRequestRegistry } from '../../engine/graph/foregroundRun/requestRegistry';
import { clearAgentRunCancellation } from '../../services/agents/agentRunCancellation';
import { createAgentRunIdentityKey } from '../../services/agents/agentRunIdentity';
import { resolveConversationProviderContext } from '../../services/llm/support/providerSupport';
import {
  drainIngestionQueueWithWakeup,
  getIngestionJob,
  type IngestionJob,
} from '../../services/memory/ingestionQueue';
import { listIngestionPersistenceReceipts } from '../../services/memory/ingestionReceiptStore';
import {
  loadIngestionJobRuntimeContext,
  recordCompletedTurnForMemory,
} from '../../services/memory/lifecycle';
import { createAgentRunFinalResponse } from '../../screens/agentRunFinalResponse';
import { truncateLogDetail } from '../../screens/chatFormatting';
import {
  STREAM_STORE_CHECKPOINT_INTERVAL_MS,
  STREAM_UI_DRAFT_PUBLISH_INTERVAL_MS,
  TOOL_RESULT_PERSISTENCE_CHECKPOINT_DELAY_MS,
} from '../../screens/chatScreenConstants';
import { requestChatStorePersistenceCheckpoint } from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { AgentRun } from '../../types/agentRun';
import type { Conversation, ConversationMode } from '../../types/conversation';
import type { Message } from '../../types/message';
import type { ConversationUsageSummary } from '../../types/usage';
import { generateId } from '../../utils/id';
import { cloneAndFreeze } from './foregroundScenarioDriverTypes';
import { isE2EGraphExecutionComplete } from './e2eGraphCompletion';
import type {
  ForegroundScenarioCompletionSnapshot,
  ForegroundScenarioDriverInput,
  ForegroundScenarioExecutionContextSnapshot,
  ForegroundScenarioFinalAssistantSnapshot,
  ForegroundScenarioMemoryRecord,
  ForegroundScenarioMemorySnapshot,
  ForegroundScenarioRouteDirective,
} from './foregroundScenarioDriverTypes';

const MEMORY_JOB_INITIAL_POLL_MS = 10;
const MEMORY_JOB_MAX_POLL_MS = 500;

export type ForegroundScenarioRequestRegistry = ReturnType<typeof createRequestRegistry>;

export type ForegroundScenarioRuntime = {
  context: ExecuteForegroundConversationRunParams['context'];
  getChatError: () => string | null;
  requests: ForegroundScenarioRequestRegistry;
  resetChatError: () => void;
  setActiveTurnMaxTokens: (maxTokens: number | undefined) => void;
};

export async function ensureForegroundScenarioStoresHydrated(): Promise<void> {
  if (!useChatStore.persist.hasHydrated()) await useChatStore.persist.rehydrate();
  if (!useSettingsStore.persist.hasHydrated()) await useSettingsStore.persist.rehydrate();
}

export function createSeedConversation(input: ForegroundScenarioDriverInput): Conversation {
  const now = Date.now();
  return {
    id: input.conversationId,
    title: input.conversationTitle.trim(),
    messages: JSON.parse(JSON.stringify(input.initialMessages ?? [])),
    providerId: input.provider.id,
    modelOverride: input.provider.model,
    systemPrompt: input.systemPrompt,
    createdAt: now,
    updatedAt: now,
    personaId: resolveConversationPersonaForMode({ nextMode: input.defaultMode }),
    mode: input.defaultMode,
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      totalCalls: 0,
    },
    logs: [],
    agentRuns: [],
  };
}

export function applyForegroundScenarioRoute(
  conversationId: string,
  directive: ForegroundScenarioRouteDirective,
  defaultMode: ConversationMode,
): ForegroundScenarioExecutionContextSnapshot {
  const before = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!before) throw new Error(`Conversation ${conversationId} is unavailable.`);

  if (directive !== 'production_auto') {
    const mode = directive === 'forced_agentic' ? 'agentic' : 'chitchat';
    const personaId = resolveConversationPersonaForMode({
      conversationPersonaId: before.personaId,
      nextMode: mode,
    });
    const store = useChatStore.getState();
    store.updateModeInConversation(conversationId, mode);
    store.updatePersonaInConversation(conversationId, personaId);
  }

  return resolveForegroundScenarioExecutionContext(conversationId, defaultMode);
}

export function resolveForegroundScenarioExecutionContext(
  conversationId: string,
  defaultMode: ConversationMode,
): ForegroundScenarioExecutionContextSnapshot {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  return resolveForegroundConversationExecutionContext({
    conversation,
    defaultConversationMode: defaultMode,
  });
}

export function resolveForegroundScenarioFinalAssistant(
  messages: ReadonlyArray<Message>,
): Readonly<{
  candidateCount: number;
  selected: ForegroundScenarioFinalAssistantSnapshot | null;
}> {
  const finalMessages = messages.filter(
    (message) => message.role === 'assistant' && message.assistantMetadata?.kind === 'final',
  );
  const message = finalMessages[finalMessages.length - 1];
  if (!message?.assistantMetadata) {
    return { candidateCount: finalMessages.length, selected: null };
  }
  return {
    candidateCount: finalMessages.length,
    selected: {
      messageId: message.id,
      text: message.content,
      timestamp: message.timestamp,
      completionStatus: message.assistantMetadata.completionStatus,
      finishReason: message.assistantMetadata.finishReason ?? null,
      terminalReason: message.assistantMetadata.terminalReason ?? null,
    },
  };
}

export function buildForegroundScenarioCompletionSnapshot(params: {
  error: string | null;
  finalAssistant: ForegroundScenarioFinalAssistantSnapshot | null;
  route: ForegroundScenarioExecutionContextSnapshot;
  run: AgentRun | null;
  timedOut: boolean;
}): ForegroundScenarioCompletionSnapshot {
  const runStatus =
    params.route.mode === 'agentic' ? (params.run?.status ?? 'missing') : 'not_applicable';
  const graphStatus = params.run?.controlGraph?.status ?? null;
  return {
    assistantStatus: params.finalAssistant?.completionStatus ?? 'missing',
    executionCompleted:
      !params.error &&
      !params.timedOut &&
      (params.route.mode === 'chitchat' || isE2EGraphExecutionComplete(graphStatus)),
    finalResponseCompleted: params.finalAssistant?.completionStatus === 'complete',
    runStatus,
    runCompleted: runStatus === 'not_applicable' ? null : runStatus === 'completed',
    runCompletedAt: params.run?.completedAt ?? null,
    runTerminalReason: params.run?.terminalReason ?? null,
    graphStatus,
    graphTerminalReason: params.run?.controlGraph?.terminalReason ?? null,
  };
}

function createRequestRegistry() {
  const registry = createForegroundRequestRegistry();
  const pendingAbortReasons = new Map<string, string | undefined>();

  return {
    abortForegroundRequestForConversation: (conversationId: string, reason?: string) =>
      registry.abortForConversation(conversationId, reason),
    abortCurrentOrNextForegroundRequest: (conversationId: string, reason?: string) => {
      if (!registry.abortForConversation(conversationId, reason)) {
        pendingAbortReasons.set(conversationId, reason);
      }
    },
    clearForegroundRequest: (
      conversationId: string,
      requestId: string,
      controller: AbortController,
    ) => {
      if (!registry.clear({ conversationId, requestId, controller })) return false;
      pendingAbortReasons.delete(conversationId);
      useChatStore.getState().setLoading(registry.size > 0);
      return true;
    },
    isCurrentForegroundRequest: (
      conversationId: string,
      requestId: string,
      controller: AbortController,
    ) => registry.isCurrent({ conversationId, requestId, controller }),
    registerForegroundRequest: (
      requestId: string,
      conversationId: string,
      controller: AbortController,
    ) => {
      registry.register({ conversationId, requestId, controller });
      useChatStore.getState().setLoading(registry.size > 0);
      if (pendingAbortReasons.has(conversationId)) {
        registry.abort(
          { conversationId, requestId, controller },
          pendingAbortReasons.get(conversationId),
        );
        pendingAbortReasons.delete(conversationId);
      }
    },
    setStreamingMessageId: (
      conversationId: string,
      requestId: string,
      controller: AbortController,
      messageId: string | null,
    ) => registry.setStreamingMessageId({ conversationId, requestId, controller }, messageId),
  };
}

function createStreamingState() {
  const drafts: Record<string, ForegroundStreamingDraft | undefined> = {};
  return {
    drafts,
    clearStreamingDraft: (messageId: string) => {
      delete drafts[messageId];
    },
    mergeStreamingDraft: (messageId: string, patch: Partial<ForegroundStreamingDraft>) => {
      drafts[messageId] = { ...(drafts[messageId] ?? {}), ...patch };
    },
    updateStreamingDraft: (
      messageId: string,
      updater: (
        currentDraft: ForegroundStreamingDraft | undefined,
      ) => ForegroundStreamingDraft | undefined,
    ) => {
      const next = updater(drafts[messageId]);
      if (next) drafts[messageId] = next;
      else delete drafts[messageId];
    },
  };
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function awaitMemoryJob(jobId: string, deadline: number): Promise<IngestionJob> {
  let requestedDrain = false;
  let pollDelayMs = MEMORY_JOB_INITIAL_POLL_MS;
  while (Date.now() <= deadline) {
    const job = getIngestionJob(jobId);
    if (!job) throw new Error(`Memory ingestion job ${jobId} disappeared before completion.`);
    if (!['pending', 'processing'].includes(job.status)) return job;

    if (job.status === 'pending' && !requestedDrain) {
      requestedDrain = true;
      await drainIngestionQueueWithWakeup({
        loadMessagesForThread: (threadId) =>
          useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === threadId)?.messages ?? [],
        loadRuntimeContextForJob: loadIngestionJobRuntimeContext,
        maxJobs: 1,
      });
      const afterDrain = getIngestionJob(jobId);
      if (
        afterDrain?.status === 'pending' &&
        afterDrain.nextAttemptAt !== null &&
        afterDrain.nextAttemptAt > Date.now()
      ) {
        return afterDrain;
      }
      continue;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(pollDelayMs, remainingMs));
    pollDelayMs = Math.min(pollDelayMs * 2, MEMORY_JOB_MAX_POLL_MS);
  }
  throw new Error(`Timed out waiting for memory ingestion job ${jobId}.`);
}

export async function settleForegroundScenarioMemory(
  records: ReadonlyArray<ForegroundScenarioMemoryRecord>,
  timeoutMs: number,
): Promise<ReadonlyArray<ForegroundScenarioMemorySnapshot>> {
  const results = await Promise.all(records.map((record) => record.promise));
  const deadline = Date.now() + timeoutMs;
  const snapshots = await Promise.all(
    results.map(async (result) => {
      const job = result.jobId ? await awaitMemoryJob(result.jobId, deadline) : null;
      return {
        lifecycle: result,
        job,
        receipts: result.jobId ? listIngestionPersistenceReceipts(result.jobId) : [],
      };
    }),
  );
  return cloneAndFreeze(snapshots);
}

export function resolveForegroundScenarioTurnRun(
  conversation: Conversation,
  userMessageId: string,
  priorRunIds: ReadonlySet<string>,
): AgentRun | null {
  const runs = (conversation.agentRuns ?? []).filter(
    (run) => run.userMessageId === userMessageId && !priorRunIds.has(run.id),
  );
  if (runs.length > 1) {
    throw new Error(`Foreground turn created ${runs.length} AgentRuns; expected at most one.`);
  }
  return runs[0] ?? null;
}

export function buildForegroundScenarioUsageDelta(
  before: ConversationUsageSummary | undefined,
  after: ConversationUsageSummary | undefined,
): ConversationUsageSummary | null {
  if (!after) return null;
  const totalCalls = Math.max(0, after.totalCalls - (before?.totalCalls ?? 0));
  const entries = totalCalls > 0 ? after.entries.slice(-totalCalls) : [];
  const latestEntry = entries[entries.length - 1];
  return {
    entries,
    totalInput: Math.max(0, after.totalInput - (before?.totalInput ?? 0)),
    totalOutput: Math.max(0, after.totalOutput - (before?.totalOutput ?? 0)),
    totalCacheRead: Math.max(0, after.totalCacheRead - (before?.totalCacheRead ?? 0)),
    totalCacheWrite: Math.max(0, after.totalCacheWrite - (before?.totalCacheWrite ?? 0)),
    totalTokens: Math.max(0, after.totalTokens - (before?.totalTokens ?? 0)),
    totalCost: Math.max(0, after.totalCost - (before?.totalCost ?? 0)),
    totalCalls,
    ...(latestEntry
      ? {
          lastModel: latestEntry.model,
          lastProviderId: latestEntry.providerId,
          lastUpdatedAt: latestEntry.timestamp,
        }
      : {}),
  };
}

export function createForegroundScenarioRuntime(
  input: ForegroundScenarioDriverInput,
  memoryRecords: ForegroundScenarioMemoryRecord[],
): ForegroundScenarioRuntime {
  const requests = createRequestRegistry();
  const streaming = createStreamingState();
  const pendingFinalizations = new Map<string, Promise<string | undefined>>();
  const pendingTerminalReviews = new Map<string, Promise<void>>();
  const pendingAsyncResumes = new Map<string, Promise<void>>();
  let chatError: string | null = null;
  let activeTurnMaxTokens = input.maxTokens;
  let context: ExecuteForegroundConversationRunParams['context'];

  const recordConversationTurnMemory: ExecuteForegroundConversationRunParams['context']['helpers']['recordConversationTurnMemory'] = (
    conversationId,
    activeChatProvider,
    options = {},
  ) => {
    const conversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return;
    memoryRecords.push({
      promise: recordCompletedTurnForMemory({
        threadId: conversationId,
        memoryConversationId: options.memoryConversationId,
        messages: conversation.messages,
        threadTitle: conversation.title,
        activeChatProvider,
        sourceRunId: options.sourceRunId,
      }),
    });
  };

  const ensureAgentRunFinalResponse = createAgentRunFinalResponse({
    appendAgentRunCheckpoint: (...args) =>
      useChatStore.getState().appendAgentRunCheckpoint(...args),
    appendConversationLog: (conversationId, entry) =>
      useChatStore.getState().addConversationLog(conversationId, {
        ...entry,
        detail: truncateLogDetail(entry.detail),
      }),
    pendingAgentRunFinalizations: pendingFinalizations,
    getResolveConversationFinalizationContext: () => async (conversation) => {
      const settings = useSettingsStore.getState();
      const providerContext = await resolveConversationProviderContext({
        activeModel: settings.activeModel,
        activeProviderId: settings.activeProviderId,
        conversation,
        providers: settings.providers,
        systemPrompt: settings.systemPrompt,
      });
      if (!providerContext) return undefined;
      const route = resolveForegroundConversationExecutionContext({
        conversation,
        defaultConversationMode: settings.defaultConversationMode,
      });
      return {
        ...providerContext,
        conversationId: conversation.id,
        personaId: route.personaId,
        internalUserMessageCount: 0,
      };
    },
    setAgentRunPhase: (...args) => useChatStore.getState().setAgentRunPhase(...args),
    updateAgentRunSummary: (...args) => useChatStore.getState().updateAgentRunSummary(...args),
    updateMessage: (...args) => useChatStore.getState().updateMessage(...args),
    updateMessageAssistantMetadata: (...args) =>
      useChatStore.getState().updateMessageAssistantMetadata(...args),
    updateMessageProviderReplay: (...args) =>
      useChatStore.getState().updateMessageProviderReplay(...args),
  });

  const resumeAgentRun: ResumeAgentRun = async (params) => {
    await executeForegroundConversationRun({
      conversationId: params.conversationId,
      context,
      options: {
        reuseAgentRunId: params.runId,
        reuseAssistantDraft: params.reuseAssistantDraft,
        additionalSystemPrompt: params.additionalSystemPrompt,
        additionalUserPrompt: params.additionalUserPrompt,
        disableTools: params.disableTools,
        initialPendingAsyncOperations: params.initialPendingAsyncOperations,
        maxTokens: activeTurnMaxTokens,
      },
    });
  };

  const store = useChatStore.getState();
  const settings = useSettingsStore.getState();
  context = {
    helpers: {
      appendConversationLog: (conversationId, entry) =>
        useChatStore.getState().addConversationLog(conversationId, {
          ...entry,
          detail: truncateLogDetail(entry.detail),
        }),
      clearPendingRunState: (conversationId, runId) => {
        const runIdentityKey = createAgentRunIdentityKey({ conversationId, runId });
        pendingFinalizations.delete(runIdentityKey);
        pendingTerminalReviews.delete(runIdentityKey);
        pendingAsyncResumes.delete(runIdentityKey);
      },
      clearTrackedRunCancellation: clearAgentRunCancellation,
      createId: generateId,
      ensureAgentRunFinalResponse,
      ensureCanonicalConversation: (options = {}) => {
        const currentSettings = useSettingsStore.getState();
        const providerId = options.providerId ?? currentSettings.activeProviderId;
        if (!providerId) {
          if (options.reportMissingProvider) chatError = 'No provider configured.';
          return null;
        }
        const provider = currentSettings.providers.find((candidate) => candidate.id === providerId);
        return useChatStore.getState().getOrCreateCanonicalThread(
          providerId,
          currentSettings.systemPrompt,
          options.model ?? provider?.model,
          {
            activate: options.activate,
            personaId: options.personaId,
            mode: options.mode,
          },
        );
      },
      getConversation: (conversationId) =>
        useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === conversationId),
      getConversations: () => useChatStore.getState().conversations,
      getResumeAgentRun: () => resumeAgentRun,
      recordConversationTurnMemory,
      requestPersistenceCheckpoint: requestChatStorePersistenceCheckpoint,
      setChatError: (message) => {
        chatError = message;
      },
    },
    refs: {
      forceNextScrollRef: { current: false },
      pendingAgentRunAsyncResumesRef: { current: pendingAsyncResumes },
      pendingAgentRunFinalizationsRef: { current: pendingFinalizations },
      pendingAgentRunTerminalReviewsRef: { current: pendingTerminalReviews },
      shouldAutoFollowRef: { current: true },
      streamingDraftsRef: { current: streaming.drafts },
    },
    requests,
    state: {
      activeModel: settings.activeModel,
      activeProviderId: settings.activeProviderId,
      chatNoApiKeyMessage: 'The selected provider has no API key.',
      chatNoModelMessage: 'The selected provider has no model.',
      chatNoProviderMessage: 'No provider configured.',
      defaultConversationMode: settings.defaultConversationMode,
      exportDialogTitle: 'Export conversation',
      linkUnderstandingEnabled: settings.linkUnderstandingEnabled,
      maxLinks: settings.maxLinks,
      mediaUnderstandingEnabled: settings.mediaUnderstandingEnabled,
      providers: settings.providers,
      streamStoreCheckpointIntervalMs: STREAM_STORE_CHECKPOINT_INTERVAL_MS,
      streamUiDraftPublishIntervalMs: STREAM_UI_DRAFT_PUBLISH_INTERVAL_MS,
      systemPrompt: settings.systemPrompt,
      thinkingLevel: settings.thinkingLevel,
      toolResultPersistenceCheckpointDelayMs: TOOL_RESULT_PERSISTENCE_CHECKPOINT_DELAY_MS,
    },
    store: {
      addMessage: store.addMessage,
      addToolCall: store.addToolCall,
      appendAgentRunCheckpoint: store.appendAgentRunCheckpoint,
      applyConversationCompaction: store.applyConversationCompaction,
      completeAgentRun: store.completeAgentRun,
      setAgentRunPhase: store.setAgentRunPhase,
      startAgentRun: store.startAgentRun,
      updateAgentRunAsyncWork: store.updateAgentRunAsyncWork,
      updateAgentRunControlGraph: store.updateAgentRunControlGraph,
      updateAgentRunPlan: store.updateAgentRunPlan,
      updateAgentRunSummary: store.updateAgentRunSummary,
      updateMessage: store.updateMessage,
      updateMessageAssistantMetadata: store.updateMessageAssistantMetadata,
      updateMessageEffect: store.updateMessageEffect,
      updateMessageEnrichedContent: store.updateMessageEnrichedContent,
      updateMessageProviderReplay: store.updateMessageProviderReplay,
      updateMessageReasoning: store.updateMessageReasoning,
      updateToolCallStatus: store.updateToolCallStatus,
    },
    streaming,
  };

  return {
    context,
    getChatError: () => chatError,
    requests,
    resetChatError: () => {
      chatError = null;
    },
    setActiveTurnMaxTokens: (maxTokens) => {
      activeTurnMaxTokens = maxTokens;
    },
  };
}
