import { buildAssistantMessageMetadata } from '../../../utils/assistantMessageMetadata';

type AssistantDraftFinishReason = 'response_failed' | 'terminal_review_pending';

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
  updateMetadata: (messageId: string, metadata: ReturnType<typeof buildForegroundAssistantIncompleteMetadata>) => void;
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
  handleSuccessfulCompletion: () => Promise<void>;
  isAbortErrorLike: (error: unknown) => boolean;
  isAborted: () => boolean;
  requestPersistenceCheckpoint: () => void;
}) {
  let didEncounterTerminalError = false;
  let completionPromise: Promise<void> | null = null;

  const handleError = (error: Error) => {
    didEncounterTerminalError = true;
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

    completionPromise = params.completeOnce(async () => {
      params.flushPendingSurfacedOutputs();
      params.ensureAssistantTurn();
      params.markCurrentAssistantPendingReview({
        currentAssistantMessageId: params.getCurrentAssistantMessageId(),
        visibleContent: params.getVisibleAssistantContent(),
      });
      params.commitAssistantBuffers();
      if (!params.isAborted()) {
        await params.handleSuccessfulCompletion();
      }
      params.clearForegroundRequestIfCurrent();
    });
  };

  const handleCatch = (error: unknown) => {
    params.commitAssistantBuffers();
    const currentAssistantMessageId = params.getCurrentAssistantMessageId();
    params.clearStreamingDraft(currentAssistantMessageId);

    if (!params.isAbortErrorLike(error)) {
      params.finalizeCaughtFailure({
        currentAssistantMessageId,
        errorMessage: error instanceof Error ? error.message : String(error),
        visibleContent: params.getVisibleAssistantContent(),
      });
    } else {
      params.finalizeCaughtAbort();
    }

    params.clearForegroundRequestIfCurrent();
  };

  const awaitCompletion = async () => {
    if (completionPromise) {
      await completionPromise;
    }
  };

  return {
    awaitCompletion,
    handleCatch,
    handleDone,
    handleError,
  };
}
