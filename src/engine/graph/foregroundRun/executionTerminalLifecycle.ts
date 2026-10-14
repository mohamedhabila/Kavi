import {
  isAbortErrorLike,
  throwIfAbortSignalTriggered,
} from '../../../services/agents/agentRunCancellation';
import { handleForegroundRunCompletionFlow } from './completionFlow';
import { reviewForegroundRunCompletion } from './completionReview';
import type {
  ForegroundConversationRunRuntimeParams,
  ForegroundRunLogEntryInput,
} from './executionTypes';
import type { ForegroundRunMutableState } from './executionRuntimeState';
import { resolveForegroundInterruptedResponseOutcome } from './foregroundInterruptedResponse';
import { handleForegroundInterruptedResponseRecovery } from './interruptedResponseRecovery';
import {
  applyForegroundAssistantDraftIncomplete,
  createForegroundRunTerminalLifecycleController,
} from './terminalLifecycle';
import { buildForegroundRunTrackingState } from './trackingState';
import { buildForegroundRunTurnSummary } from './turnSummary';
import { createForegroundAssistantStreamController } from './assistantStreamController';
import { createForegroundTrackedRunStore } from './trackedRunStore';
import {
  buildForegroundRunAbortCompletionEffect,
  buildForegroundRunFailureEffect,
} from '../foregroundRunTerminalEffects';

type RuntimeTerminalLifecycleParams = Pick<
  ForegroundConversationRunRuntimeParams,
  | 'clearForegroundRequestIfCurrent'
  | 'completeRunOnce'
  | 'conversationId'
  | 'getCurrentConversation'
  | 'shared'
> & {
  abort: AbortController;
  assistantStream: ReturnType<typeof createForegroundAssistantStreamController>;
  appendConversationLog: (entry: ForegroundRunLogEntryInput) => void;
  flushPendingSurfacedSubAgentOutputs: () => void;
  getCurrentAssistantMessageId: () => string;
  mutableState: ForegroundRunMutableState;
  runId?: string;
  runStartedAt: number;
  trackedRunStore: ReturnType<typeof createForegroundTrackedRunStore>;
};

export function createForegroundRunTerminalLifecycle(params: RuntimeTerminalLifecycleParams) {
  const {
    abort,
    appendConversationLog,
    assistantStream,
    clearForegroundRequestIfCurrent,
    completeRunOnce,
    conversationId,
    flushPendingSurfacedSubAgentOutputs,
    getCurrentAssistantMessageId,
    getCurrentConversation,
    mutableState,
    runId,
    runStartedAt,
    shared,
    trackedRunStore,
  } = params;

  return createForegroundRunTerminalLifecycleController({
    clearForegroundRequestIfCurrent,
    clearStreamingDraft: shared.streaming.clearStreamingDraft,
    commitAssistantBuffers: () => assistantStream.commitBuffers(true),
    completeOnce: completeRunOnce,
    ensureAssistantTurn: assistantStream.ensureAssistantTurn,
    finalizeCaughtAbort: () => {
      const abortedEffect = buildForegroundRunAbortCompletionEffect();
      trackedRunStore.finalizeRun(
        abortedEffect.status,
        abortedEffect.latestSummary ?? 'The current run was cancelled.',
        abortedEffect.checkpointTitle ?? 'Turn cancelled',
        abortedEffect.checkpointDetail,
        abortedEffect.terminalReason,
      );
    },
    finalizeCaughtFailure: ({ errorMessage, visibleContent }) => {
      const failureEffect = buildForegroundRunFailureEffect(errorMessage);
      applyForegroundAssistantDraftIncomplete({
        finishReason: 'response_failed',
        messageId: getCurrentAssistantMessageId(),
        updateMetadata: (messageId, metadata) => {
          shared.store.updateMessageAssistantMetadata(conversationId, messageId, metadata);
        },
        visibleContent,
      });
      trackedRunStore.finalizeRun(
        failureEffect.completion.status,
        failureEffect.completion.latestSummary ?? errorMessage,
        failureEffect.completion.checkpointTitle ?? 'Turn failed',
        failureEffect.completion.checkpointDetail,
        failureEffect.completion.terminalReason,
      );
      shared.helpers.setChatError(failureEffect.chatError);
      appendConversationLog(failureEffect.logEntry);
    },
    flushPendingSurfacedOutputs: flushPendingSurfacedSubAgentOutputs,
    getCurrentAssistantMessageId,
    getVisibleAssistantContent: () => assistantStream.getVisibleAssistantContent(),
    handleInterruptedError: async ({ currentAssistantMessageId, error, visibleContent }) => {
      throwIfAbortSignalTriggered(abort.signal);
      applyForegroundAssistantDraftIncomplete({
        finishReason: 'response_failed',
        messageId: currentAssistantMessageId,
        updateMetadata: (messageId, metadata) => {
          shared.store.updateMessageAssistantMetadata(conversationId, messageId, metadata);
        },
        visibleContent,
      });
      handleForegroundInterruptedResponseRecovery({
        appendConversationLog: shared.helpers.appendConversationLog,
        assertNotAborted: () => throwIfAbortSignalTriggered(abort.signal),
        conversationId,
        currentAssistantMessageId,
        errorMessage: error.message,
        finalizeTrackedRun: trackedRunStore.finalizeRun,
        outcome: resolveForegroundInterruptedResponseOutcome({ conversationId, error, runId }),
        requestPersistenceCheckpoint: shared.helpers.requestPersistenceCheckpoint,
        runId,
        setAgentRunPhase: shared.store.setAgentRunPhase,
        setChatError: shared.helpers.setChatError,
        updateAgentRunSummary: shared.store.updateAgentRunSummary,
        updateMessage: shared.store.updateMessage,
        updateMessageAssistantMetadata: shared.store.updateMessageAssistantMetadata,
        visibleContent,
      });
    },
    handleSuccessfulCompletion: async ({ forceTerminalReview }) => {
      const turnSummary = buildForegroundRunTurnSummary({
        durationMs: Date.now() - runStartedAt,
        assistantTurns: mutableState.assistantTurnCount,
        startedTools: mutableState.startedToolCount,
        completedTools: mutableState.completedToolCount,
        failedTools: mutableState.failedToolCount,
        spawnedSubAgents: mutableState.spawnedSubAgentCount,
      });
      const trackedRunState = buildForegroundRunTrackingState({
        conversation: getCurrentConversation(),
        fallbackPendingAsyncOperations: mutableState.latestPendingAsyncOperations,
        recordedSpawnedSubAgents: mutableState.spawnedSubAgentCount,
        runId,
      });
      handleForegroundRunCompletionFlow({
        appendConversationLog,
        currentAssistantMessage: getCurrentConversation()?.messages.find(
          (candidate) => candidate.id === getCurrentAssistantMessageId(),
        ),
        currentAssistantMessageId: getCurrentAssistantMessageId(),
        enterAsyncMonitoringPhase: trackedRunStore.enterWorkPhase,
        forceTerminalReview,
        finalizeCompletion: (completionReview) => {
          return trackedRunStore.finalizeRun(
            completionReview.completionStatus,
            completionReview.latestSummary,
            completionReview.checkpointTitle,
            completionReview.checkpointDetail,
            completionReview.completionTerminalReason,
          );
        },
        reviewCompletion: () =>
          reviewForegroundRunCompletion({
            appendConversationLog: shared.helpers.appendConversationLog,
            conversationId,
            finalizeTrackedRun: trackedRunStore.finalizeRun,
            runId,
            setChatError: shared.helpers.setChatError,
            turnSummary,
            updateMessageAssistantMetadata: shared.store.updateMessageAssistantMetadata,
          }),
        trackedRunState,
        turnSummary,
      });
    },
    isAbortErrorLike: (error) => isAbortErrorLike(error, abort.signal),
    isAborted: () => abort.signal.aborted,
    requestPersistenceCheckpoint: () => shared.helpers.requestPersistenceCheckpoint(),
  });
}
