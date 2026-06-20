import type { Message, ToolCall } from '../../../types/message';
import { recordImageToolConversationUsage } from '../../../services/usage/conversationUsage';
import { createForegroundAssistantMessageController } from './assistantMessageController';
import { createForegroundAssistantStreamController } from './assistantStreamController';
import { createForegroundCommandResultController } from './commandResultController';
import { createForegroundTrackedRunStore } from './trackedRunStore';
import { createForegroundToolCallLifecycleController } from './toolCallLifecycle';
import type {
  ForegroundConversationRunRuntimeParams,
  ForegroundRunLogEntryInput,
} from './executionTypes';
import type { ForegroundRunMutableState } from './executionRuntimeState';
import {
  buildForegroundSurfacedWorkerFlushEffect,
  type PendingSurfacedWorkerOutput,
} from './surfacedWorkerOutput';
import {
  mergeForegroundStreamingToolCall,
  mergeForegroundStreamingToolCalls,
} from './streamingToolCalls';

type RuntimeControllersParams = Pick<
  ForegroundConversationRunRuntimeParams,
  'bootstrapResult' | 'conversationId' | 'getCurrentConversation' | 'provider' | 'shared'
> & {
  appendConversationLog: (entry: ForegroundRunLogEntryInput) => void;
  mutableState: ForegroundRunMutableState;
  runId?: string;
  runStartedAt: number;
};

export function createForegroundRunRuntimeControllers(params: RuntimeControllersParams) {
  const {
    appendConversationLog,
    bootstrapResult,
    conversationId,
    getCurrentConversation,
    mutableState,
    provider,
    runId,
    runStartedAt,
    shared,
  } = params;

  const trackedRunStore = createForegroundTrackedRunStore({
    actions: {
      appendAgentRunCheckpoint: shared.store.appendAgentRunCheckpoint,
      completeAgentRun: shared.store.completeAgentRun,
      setAgentRunPhase: shared.store.setAgentRunPhase,
      updateAgentRunAsyncWork: shared.store.updateAgentRunAsyncWork,
      updateAgentRunControlGraph: shared.store.updateAgentRunControlGraph,
      updateAgentRunPlan: shared.store.updateAgentRunPlan,
      updateAgentRunSummary: shared.store.updateAgentRunSummary,
    },
    conversationId,
    getCurrentCounters: () => ({
      assistantTurns: mutableState.assistantTurnCount,
      startedTools: mutableState.startedToolCount,
      completedTools: mutableState.completedToolCount,
      failedTools: mutableState.failedToolCount,
      spawnedSubAgents: mutableState.spawnedSubAgentCount,
      runStartedAt,
    }),
    getLatestConversation: () => getCurrentConversation(),
    runId,
  });

  const assistantStream = createForegroundAssistantStreamController({
    actions: {
      clearStreamingDraft: shared.streaming.clearStreamingDraft,
      mergeStreamingDraft: shared.streaming.mergeStreamingDraft,
      startAssistantTurn: (messageId) => {
        shared.refs.forceNextScrollRef.current = shared.refs.shouldAutoFollowRef.current;
        shared.store.addMessage(conversationId, {
          id: messageId,
          role: 'assistant',
          content: '',
        });
        shared.requests.setStreamingMessageId(messageId);
        mutableState.assistantTurnCount += 1;
        trackedRunStore.syncSummary();
      },
      updateMessage: (messageId, content) =>
        shared.store.updateMessage(conversationId, messageId, content),
      updateMessageReasoning: (messageId, reasoning) =>
        shared.store.updateMessageReasoning(conversationId, messageId, reasoning),
    },
    checkpointIntervalMs: shared.state.streamStoreCheckpointIntervalMs,
    createAssistantMessageId: shared.helpers.createId,
    currentAssistantMessageId: bootstrapResult.assistantMessageId,
    getStreamingDraft: (messageId) => shared.refs.streamingDraftsRef.current[messageId],
    publishIntervalMs: shared.state.streamUiDraftPublishIntervalMs,
    resumedAssistantDraft: bootstrapResult.bootstrap.resumedAssistantDraft,
  });

  const getCurrentAssistantMessageId = () => assistantStream.getCurrentAssistantMessageId();
  const getPersistedAssistantMessage = (messageId: string): Message | undefined =>
    getCurrentConversation()?.messages.find((message) => message.id === messageId);
  const getPersistedAssistantToolCalls = (messageId: string): ToolCall[] | undefined =>
    getPersistedAssistantMessage(messageId)?.toolCalls;

  const upsertLiveToolCall = (messageId: string, toolCall: ToolCall) => {
    if (!toolCall.id?.trim() || !toolCall.name?.trim()) {
      return;
    }

    shared.streaming.updateStreamingDraft(messageId, (currentDraft) => ({
      ...(currentDraft ?? {}),
      toolCalls: mergeForegroundStreamingToolCall(
        currentDraft?.toolCalls ?? getPersistedAssistantToolCalls(messageId),
        toolCall,
      ),
    }));
  };

  const mergeLiveToolCalls = (messageId: string, toolCalls: ToolCall[]) => {
    const validToolCalls = toolCalls.filter(
      (toolCall) => toolCall.id?.trim() && toolCall.name?.trim(),
    );
    if (validToolCalls.length === 0) {
      return;
    }

    shared.streaming.updateStreamingDraft(messageId, (currentDraft) => ({
      ...(currentDraft ?? {}),
      toolCalls: mergeForegroundStreamingToolCalls(
        currentDraft?.toolCalls ?? getPersistedAssistantToolCalls(messageId),
        validToolCalls,
      ),
    }));
  };

  const clearSurfacedSubAgentOutputLock = () => {
    mutableState.surfacedSubAgentOutputLock = null;
  };

  const flushSurfacedSubAgentOutput = (toolCallId: string) => {
    const surfacedMessageId = shared.helpers.createId();
    const surfacedOutputEffect = buildForegroundSurfacedWorkerFlushEffect({
      pendingOutputs: mutableState.pendingSurfacedSubAgentOutputs as Map<
        string,
        PendingSurfacedWorkerOutput
      >,
      surfacedMessageId,
      toolCallId,
    });
    if (!surfacedOutputEffect) {
      return false;
    }

    assistantStream.commitBuffers(true);
    shared.refs.forceNextScrollRef.current = shared.refs.shouldAutoFollowRef.current;
    shared.store.addMessage(conversationId, surfacedOutputEffect.assistantMessage);
    shared.requests.setStreamingMessageId(surfacedOutputEffect.assistantMessage.id);
    mutableState.surfacedSubAgentOutputLock = surfacedOutputEffect.lock;
    trackedRunStore.syncSummary(surfacedOutputEffect.latestSummary);
    return true;
  };

  const flushPendingSurfacedSubAgentOutputs = () => {
    for (const toolCallId of Array.from(mutableState.pendingSurfacedSubAgentOutputs.keys())) {
      flushSurfacedSubAgentOutput(toolCallId);
    }
  };

  const toolCallLifecycle = createForegroundToolCallLifecycleController({
    pendingSurfacedWorkerOutputs: mutableState.pendingSurfacedSubAgentOutputs,
    accessors: {
      getCurrentAssistantMessageId,
      getLiveToolCalls: (messageId) => shared.refs.streamingDraftsRef.current[messageId]?.toolCalls,
      getPersistedAssistantToolCalls,
    },
    actions: {
      addToolCall: (assistantMessageIdToUpdate, toolCall) => {
        shared.store.addToolCall(conversationId, assistantMessageIdToUpdate, toolCall);
      },
      addToolMessage: (message) => {
        shared.store.addMessage(conversationId, message);
      },
      appendConversationLog,
      applyMessageEffect: (assistantMessageIdToUpdate, effectId) => {
        shared.streaming.mergeStreamingDraft(assistantMessageIdToUpdate, { effectId });
        shared.store.updateMessageEffect(conversationId, assistantMessageIdToUpdate, effectId);
      },
      applyToolCompletionEffect: trackedRunStore.applyToolCompletionEffect,
      applyToolStartEffect: trackedRunStore.applyToolStartEffect,
      clearSurfacedWorkerOutputLock: clearSurfacedSubAgentOutputLock,
      flushSurfacedWorkerOutput: flushSurfacedSubAgentOutput,
      recordToolUsage: (toolCall) => {
        recordImageToolConversationUsage({
          conversationId,
          toolCall,
          providerId: provider.id,
          source: 'primary',
          agentRunId: runId,
          emitLog: true,
        });
      },
      requestPersistenceCheckpoint: () => {
        shared.helpers.requestPersistenceCheckpoint(
          shared.state.toolResultPersistenceCheckpointDelayMs,
        );
      },
      trackCounters: (delta) => {
        mutableState.startedToolCount += delta.startedTools ?? 0;
        mutableState.completedToolCount += delta.completedTools ?? 0;
        mutableState.failedToolCount += delta.failedTools ?? 0;
        mutableState.spawnedSubAgentCount += delta.spawnedSubAgents ?? 0;
      },
      updateToolCallStatus: (assistantMessageIdToUpdate, toolCallId, status, patch) => {
        shared.store.updateToolCallStatus(
          conversationId,
          assistantMessageIdToUpdate,
          toolCallId,
          status,
          patch,
        );
      },
      upsertLiveToolCall,
    },
  });

  const assistantMessageController = createForegroundAssistantMessageController({
    accessors: {
      getCurrentAssistantMessageId,
      getCurrentStreamingDraft: () => assistantStream.getCurrentStreamingDraft(),
      getPersistedAssistantMessage,
      hasQueuedNextAssistantTurn: () => assistantStream.hasQueuedNextAssistantTurn(),
      isSurfacedWorkerOutputLocked: () => Boolean(mutableState.surfacedSubAgentOutputLock),
    },
    actions: {
      clearSurfacedWorkerOutputLock: clearSurfacedSubAgentOutputLock,
      commitResolvedContent: assistantStream.commitResolvedContent,
      ensureAssistantTurn: assistantStream.ensureAssistantTurn,
      enterWorkPhase: trackedRunStore.enterWorkPhase,
      mergeLiveToolCalls,
      persistToolCalls: (assistantMessageIdToUpdate, toolCalls) => {
        for (const toolCall of toolCalls) {
          shared.store.addToolCall(conversationId, assistantMessageIdToUpdate, toolCall);
        }
      },
      queueNextAssistantTurn: assistantStream.queueNextAssistantTurn,
      resolveAssistantTurnContent: assistantStream.resolveAssistantTurnContent,
      setAssistantMetadata: (messageId, metadata) => {
        shared.store.updateMessageAssistantMetadata(conversationId, messageId, metadata);
      },
      setProviderReplay: (messageId, providerReplay) => {
        shared.store.updateMessageProviderReplay(conversationId, messageId, providerReplay);
      },
      syncSummary: trackedRunStore.syncSummary,
    },
  });

  const commandResultController = createForegroundCommandResultController({
    accessors: {
      getConversation: () => getCurrentConversation(),
      getCurrentAssistantMessageId,
    },
    actions: {
      appendConversationLog,
      ensureCanonicalConversation: shared.helpers.ensureCanonicalConversation,
      updateAssistantMessage: (messageId, content) =>
        shared.store.updateMessage(conversationId, messageId, content),
    },
    exportDialogTitle: shared.state.exportDialogTitle,
    mode: shared.state.effectiveMode,
    personaId: shared.state.effectivePersonaId,
  });

  return {
    assistantMessageController,
    assistantStream,
    commandResultController,
    flushPendingSurfacedSubAgentOutputs,
    getCurrentAssistantMessageId,
    getPersistedAssistantMessage,
    isSurfacedWorkerOutputLocked: () => Boolean(mutableState.surfacedSubAgentOutputLock),
    toolCallLifecycle,
    trackedRunStore,
  };
}
