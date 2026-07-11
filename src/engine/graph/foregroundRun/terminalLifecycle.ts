import { buildAssistantMessageMetadata } from '../../../utils/assistantMessageMetadata';
import type { AgentRunControlGraphState } from '../../../types/agentRun';
import { resolveAgentControlGraphTerminalFailure } from '../terminalOutcome';

type AssistantDraftFinishReason = 'response_failed' | 'terminal_review_pending';
export type ForegroundRunTerminalStatus = 'succeeded' | 'failed' | 'cancelled';

export function buildForegroundAssistantIncompleteMetadata(
  finishReason: AssistantDraftFinishReason,
) {
  return buildAssistantMessageMetadata('final', {
    completionStatus: 'incomplete',
    finishReason,
  });
}

export function applyForegroundAssistantDraftIncomplete(params: {
  finishReason: AssistantDraftFinishReason;
  messageId: string;
  updateMetadata: (
    messageId: string,
    metadata: ReturnType<typeof buildForegroundAssistantIncompleteMetadata>,
  ) => void;
  visibleContent: string;
}): boolean {
  if (!params.visibleContent.trim()) {
    return false;
  }

  params.updateMetadata(
    params.messageId,
    buildForegroundAssistantIncompleteMetadata(params.finishReason),
  );
  return true;
}

export function createForegroundRunTerminalLifecycleController(params: {
  clearForegroundRequestIfCurrent: () => boolean;
  clearStreamingDraft: (messageId: string) => void;
  commitAssistantBuffers: () => void;
  completeOnce: (task: () => Promise<void> | void) => Promise<void>;
  ensureAssistantTurn: () => void;
  finalizeCaughtAbort: () => void;
  finalizeCaughtFailure: (context: {
    currentAssistantMessageId: string;
    errorMessage: string;
    visibleContent: string;
  }) => void;
  flushPendingSurfacedOutputs: () => void;
  getCurrentAssistantMessageId: () => string;
  getVisibleAssistantContent: () => string;
  markCurrentAssistantPendingReview: (context: {
    currentAssistantMessageId: string;
    visibleContent: string;
  }) => void;
  handleInterruptedError: (context: {
    currentAssistantMessageId: string;
    error: Error;
    visibleContent: string;
  }) => Promise<void>;
  handleSuccessfulCompletion: (options: { forceTerminalReview: boolean }) => Promise<void>;
  isAbortErrorLike: (error: unknown) => boolean;
  isAborted: () => boolean;
  requestPersistenceCheckpoint: () => void;
}) {
  let didEncounterTerminalError = false;
  let completionPromise: Promise<void> | null = null;
  let terminalStatus: ForegroundRunTerminalStatus | null = null;
  let latestControlGraphState: AgentRunControlGraphState | undefined;

  const resolveCompletedStatus = (): ForegroundRunTerminalStatus => {
    if (params.isAborted()) {
      return 'cancelled';
    }
    // A yielded foreground turn is a successful model checkpoint because the
    // foreground closeout keeps its pending workers under async monitoring.
    return resolveAgentControlGraphTerminalFailure({
      state: latestControlGraphState,
      allowYieldedCheckpoint: true,
    })
      ? 'failed'
      : 'succeeded';
  };

  const handleError = (error: Error) => {
    didEncounterTerminalError = true;
    terminalStatus = 'failed';
    completionPromise = completionPromise
      ? completionPromise
      : params.completeOnce(async () => {
          params.flushPendingSurfacedOutputs();
          params.ensureAssistantTurn();
          params.commitAssistantBuffers();

          await params.handleInterruptedError({
            currentAssistantMessageId: params.getCurrentAssistantMessageId(),
            error,
            visibleContent: params.getVisibleAssistantContent(),
          });
        });
  };

  const handleDone = () => {
    if (didEncounterTerminalError) {
      const terminalRecovery = completionPromise ?? Promise.resolve();
      completionPromise = terminalRecovery.finally(() => {
        params.clearForegroundRequestIfCurrent();
        params.requestPersistenceCheckpoint();
      });
      return;
    }

    terminalStatus = resolveCompletedStatus();
    completionPromise = params.completeOnce(async () => {
      params.flushPendingSurfacedOutputs();
      params.ensureAssistantTurn();
      if (resolveCompletedStatus() === 'succeeded') {
        params.markCurrentAssistantPendingReview({
          currentAssistantMessageId: params.getCurrentAssistantMessageId(),
          visibleContent: params.getVisibleAssistantContent(),
        });
      }
      params.commitAssistantBuffers();
      if (!params.isAborted()) {
        await params.handleSuccessfulCompletion({
          forceTerminalReview: resolveCompletedStatus() === 'failed',
        });
      }
      terminalStatus = resolveCompletedStatus();
      params.clearForegroundRequestIfCurrent();
    });
  };

  const handleCatch = (error: unknown) => {
    params.commitAssistantBuffers();
    const currentAssistantMessageId = params.getCurrentAssistantMessageId();
    params.clearStreamingDraft(currentAssistantMessageId);

    if (!params.isAbortErrorLike(error)) {
      terminalStatus = 'failed';
      params.finalizeCaughtFailure({
        currentAssistantMessageId,
        errorMessage: error instanceof Error ? error.message : String(error),
        visibleContent: params.getVisibleAssistantContent(),
      });
    } else {
      terminalStatus = 'cancelled';
      params.finalizeCaughtAbort();
    }

    params.clearForegroundRequestIfCurrent();
    return terminalStatus;
  };

  const awaitCompletion = async () => {
    if (completionPromise) {
      await completionPromise;
    }
    if (!terminalStatus) {
      throw new Error('foreground_run_terminal_status_missing');
    }
    return terminalStatus;
  };

  return {
    awaitCompletion,
    handleCatch,
    handleControlGraphState: (state: AgentRunControlGraphState) => {
      latestControlGraphState = state;
    },
    handleDone,
    handleError,
  };
}
