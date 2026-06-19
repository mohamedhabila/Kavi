import type { AgentRun } from '../../../types/agentRun';
import {
  isAbortErrorLike,
  throwIfAbortSignalTriggered,
} from '../../../services/agents/agentRunCancellation';
import { handleForegroundRunCompletionFlow } from './completionFlow';
import { reviewForegroundRunCompletion } from './completionReview';
import type { ForegroundConversationRunRuntimeParams } from './executionTypes';
import type { ForegroundRunMutableState } from './executionRuntimeState';
import { recoverForegroundAgentRunFinalPreview } from './finalPreviewRecovery';
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
  | 'finalizationProviderContext'
  | 'getCurrentConversation'
  | 'shared'
> & {
  abort: AbortController;
  assistantStream: ReturnType<typeof createForegroundAssistantStreamController>;
  appendConversationLog: (entry: {
    title: string;
    detail?: string;
    level?: AgentRun['status'] extends never ? never : any;
    kind?: any;
    timestamp?: number;
  }) => void;
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
    finalizationProviderContext,
    flushPendingSurfacedSubAgentOutputs,
    getCurrentAssistantMessageId,
    getCurrentConversation,
    mutableState,
    runId,
    runStartedAt,
    shared,
    trackedRunStore,
  } = params;

  const recoverAgentRunFinalPreview = (
    status: Exclude<AgentRun['status'], 'running'>,
    timestamp?: number,
    preferredAssistantMessageId?: string,
    signal?: AbortSignal,
  ) =>
    recoverForegroundAgentRunFinalPreview({
      conversationId,
      ensureAgentRunFinalResponse: shared.helpers.ensureAgentRunFinalResponse,
      finalizationProviderContext,
      preferredAssistantMessageId,
      runId,
      signal,
      status,
      timestamp,
    });

  const resolveInterruptedResponseOutcome = async (error: Error) =>
    resolveForegroundInterruptedResponseOutcome({
      assertNotAborted: () => throwIfAbortSignalTriggered(abort.signal),
      conversationId,
      error,
      finalizationProviderContext,
      runId,
      signal: abort.signal,
    });

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
    markCurrentAssistantPendingReview: ({ currentAssistantMessageId, visibleContent }) => {
      applyForegroundAssistantDraftIncomplete({
        finishReason: 'terminal_review_pending',
        messageId: currentAssistantMessageId,
        updateMetadata: (messageId, metadata) => {
          shared.store.updateMessageAssistantMetadata(conversationId, messageId, metadata);
        },
        visibleContent,
      });
    },
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
      const interruptedOutcome = await resolveInterruptedResponseOutcome(error);
      throwIfAbortSignalTriggered(abort.signal);
      await handleForegroundInterruptedResponseRecovery({
        appendConversationLog: shared.helpers.appendConversationLog,
        assertNotAborted: () => throwIfAbortSignalTriggered(abort.signal),
        clearForegroundRequestIfCurrent,
        conversationId,
        currentAssistantMessageId,
        errorMessage: error.message,
        finalizeTrackedRun: trackedRunStore.finalizeRun,
        markCurrentAssistantDraftIncomplete: (content, finishReason) => {
          applyForegroundAssistantDraftIncomplete({
            finishReason,
            messageId: getCurrentAssistantMessageId(),
            updateMetadata: (messageId, metadata) => {
              shared.store.updateMessageAssistantMetadata(conversationId, messageId, metadata);
            },
            visibleContent: content,
          });
        },
        outcome: interruptedOutcome,
        recoverAgentRunFinalPreview,
        requestPersistenceCheckpoint: shared.helpers.requestPersistenceCheckpoint,
        resumeAgentRun: shared.helpers.getResumeAgentRun(),
        runId,
        setAgentRunPhase: shared.store.setAgentRunPhase,
        setChatError: shared.helpers.setChatError,
        signal: abort.signal,
        updateAgentRunAsyncWork: shared.store.updateAgentRunAsyncWork,
        updateAgentRunSummary: shared.store.updateAgentRunSummary,
        updateMessage: shared.store.updateMessage,
        updateMessageAssistantMetadata: shared.store.updateMessageAssistantMetadata,
        visibleContent,
      });
    },
    handleSuccessfulCompletion: async () => {
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
      await handleForegroundRunCompletionFlow({
        appendConversationLog,
        currentAssistantMessage: getCurrentConversation()?.messages.find(
          (candidate) => candidate.id === getCurrentAssistantMessageId(),
        ),
        currentAssistantMessageId: getCurrentAssistantMessageId(),
        enterAsyncMonitoringPhase: trackedRunStore.enterWorkPhase,
        finalizeCompletion: (completionReview) => {
          trackedRunStore.finalizeRun(
            completionReview.completionStatus,
            completionReview.latestSummary,
            completionReview.checkpointTitle,
            completionReview.checkpointDetail,
            completionReview.completionTerminalReason,
          );
        },
        recordConversationTurnMemory: () =>
          shared.helpers.recordConversationTurnMemory(
            conversationId,
            shared.state.providers.find(
              (provider) => provider.id === shared.state.activeProviderId && provider.enabled,
            ),
          ),
        reviewCompletion: () =>
          reviewForegroundRunCompletion({
            appendConversationLog: shared.helpers.appendConversationLog,
            assertNotAborted: () => throwIfAbortSignalTriggered(abort.signal),
            conversationId,
            finalizeTrackedRun: trackedRunStore.finalizeRun,
            recoverAgentRunFinalPreview,
            resumeAgentRun: shared.helpers.getResumeAgentRun(),
            runId,
            signal: abort.signal,
            turnSummary,
            updateAgentRunControlGraph: shared.store.updateAgentRunControlGraph,
            updateAgentRunSummary: shared.store.updateAgentRunSummary,
            setAgentRunPhase: shared.store.setAgentRunPhase,
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
