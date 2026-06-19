import type { AgentRunAsyncOperation } from '../../../types/agentRun';
import type { Message } from '../../../types/message';
import { createForegroundRunOrchestratorCallbacks } from './orchestratorCallbacks';
import type {
  ForegroundConversationRunRuntimeParams,
  ForegroundRunLogEntryInput,
} from './executionTypes';
import { createForegroundRunRuntimeControllers } from './executionRuntimeControllers';
import { createForegroundRunMutableState } from './executionRuntimeState';
import { createForegroundRunTerminalLifecycle } from './executionTerminalLifecycle';

export function createForegroundConversationRunRuntime(
  params: ForegroundConversationRunRuntimeParams,
) {
  const {
    bootstrapResult,
    clearForegroundRequestIfCurrent,
    completeRunOnce,
    conversationId,
    finalizationProviderContext,
    getCurrentConversation,
    guardRunCallback,
    model,
    options,
    provider,
    shared,
  } = params;
  const appendConversationLog = (entry: ForegroundRunLogEntryInput) =>
    shared.helpers.appendConversationLog(conversationId, entry);
  const abort = bootstrapResult.abortController;
  const runId = bootstrapResult.trackedAgentRunId;
  const runStartedAt = bootstrapResult.initialCounters.runStartedAt;
  const mutableState = createForegroundRunMutableState({ bootstrapResult, options });
  const {
    assistantMessageController,
    assistantStream,
    commandResultController,
    flushPendingSurfacedSubAgentOutputs,
    getCurrentAssistantMessageId,
    isSurfacedWorkerOutputLocked,
    toolCallLifecycle,
    trackedRunStore,
  } = createForegroundRunRuntimeControllers({
    appendConversationLog,
    bootstrapResult,
    conversationId,
    getCurrentConversation,
    mutableState,
    provider,
    runId,
    runStartedAt,
    shared,
  });

  const terminalLifecycle = createForegroundRunTerminalLifecycle({
    abort,
    appendConversationLog,
    assistantStream,
    clearForegroundRequestIfCurrent,
    completeRunOnce,
    conversationId,
    finalizationProviderContext,
    flushPendingSurfacedSubAgentOutputs,
    getCurrentAssistantMessageId,
    getCurrentConversation,
    mutableState,
    runId,
    runStartedAt,
    shared,
    trackedRunStore,
  });

  const callbacks = createForegroundRunOrchestratorCallbacks({
    actions: {
      appendConversationLog,
      applyConversationCompaction: (messages) => {
        shared.store.applyConversationCompaction(conversationId, messages as Message[]);
      },
      setLatestPendingAsyncOperations: (operations) => {
        mutableState.latestPendingAsyncOperations = operations as AgentRunAsyncOperation[];
      },
      updateMessageEnrichedContent: (messageId, enrichedContent) => {
        shared.store.updateMessageEnrichedContent(conversationId, messageId, enrichedContent);
      },
    },
    controllers: {
      assistantMessage: assistantMessageController,
      assistantStream,
      commandResult: commandResultController,
      terminalLifecycle,
      toolCallLifecycle,
      trackedRunStore,
    },
    conversationId,
    guardRunCallback,
    isSurfacedWorkerOutputLocked,
    model,
    providerId: provider.id,
    trackedAgentRunId: runId,
  });

  return {
    callbacks,
    terminalLifecycle,
  };
}
