import {
  applyForegroundAssistantDraftIncomplete,
  buildForegroundAssistantIncompleteMetadata,
  createForegroundRunTerminalLifecycleController,
} from '../../src/engine/graph/foregroundRun/terminalLifecycle';

describe('foregroundRun terminal lifecycle controller', () => {
  it('runs interrupted recovery once and cleans up when done arrives after an error', async () => {
    const clearForegroundRequestIfCurrent = jest.fn();
    const clearStreamingDraft = jest.fn();
    const commitAssistantBuffers = jest.fn();
    const ensureAssistantTurn = jest.fn();
    const finalizeCaughtAbort = jest.fn();
    const finalizeCaughtFailure = jest.fn();
    const flushPendingSurfacedOutputs = jest.fn();
    const handleInterruptedError = jest.fn().mockResolvedValue(undefined);
    const handleSuccessfulCompletion = jest.fn();
    const markCurrentAssistantPendingReview = jest.fn();
    const requestPersistenceCheckpoint = jest.fn();

    const controller = createForegroundRunTerminalLifecycleController({
      clearForegroundRequestIfCurrent,
      clearStreamingDraft,
      commitAssistantBuffers,
      completeOnce: async (task) => {
        await task();
      },
      ensureAssistantTurn,
      finalizeCaughtAbort,
      finalizeCaughtFailure,
      flushPendingSurfacedOutputs,
      getCurrentAssistantMessageId: () => 'assistant-1',
      getVisibleAssistantContent: () => 'Partial answer',
      markCurrentAssistantPendingReview,
      handleInterruptedError,
      handleSuccessfulCompletion,
      isAbortErrorLike: () => false,
      isAborted: () => false,
      requestPersistenceCheckpoint,
    });

    controller.handleError(new Error('stream closed'));
    controller.handleDone();
    await controller.awaitCompletion();

    expect(flushPendingSurfacedOutputs).toHaveBeenCalledTimes(1);
    expect(ensureAssistantTurn).toHaveBeenCalledTimes(1);
    expect(commitAssistantBuffers).toHaveBeenCalledTimes(1);
    expect(handleInterruptedError).toHaveBeenCalledWith({
      currentAssistantMessageId: 'assistant-1',
      error: expect.any(Error),
      visibleContent: 'Partial answer',
    });
    expect(handleSuccessfulCompletion).not.toHaveBeenCalled();
    expect(clearForegroundRequestIfCurrent).toHaveBeenCalledTimes(1);
    expect(requestPersistenceCheckpoint).toHaveBeenCalledTimes(1);
    expect(clearStreamingDraft).not.toHaveBeenCalled();
    expect(finalizeCaughtFailure).not.toHaveBeenCalled();
    expect(finalizeCaughtAbort).not.toHaveBeenCalled();
  });

  it('runs normal completion and clears the foreground request on done', async () => {
    const clearForegroundRequestIfCurrent = jest.fn();
    const commitAssistantBuffers = jest.fn();
    const markCurrentAssistantPendingReview = jest.fn();
    const flushPendingSurfacedOutputs = jest.fn();
    const handleSuccessfulCompletion = jest.fn().mockResolvedValue(undefined);

    const controller = createForegroundRunTerminalLifecycleController({
      clearForegroundRequestIfCurrent,
      clearStreamingDraft: jest.fn(),
      commitAssistantBuffers,
      completeOnce: async (task) => {
        await task();
      },
      ensureAssistantTurn: jest.fn(),
      finalizeCaughtAbort: jest.fn(),
      finalizeCaughtFailure: jest.fn(),
      flushPendingSurfacedOutputs,
      getCurrentAssistantMessageId: () => 'assistant-1',
      getVisibleAssistantContent: () => 'Final answer',
      markCurrentAssistantPendingReview,
      handleInterruptedError: jest.fn(),
      handleSuccessfulCompletion,
      isAbortErrorLike: () => false,
      isAborted: () => false,
      requestPersistenceCheckpoint: jest.fn(),
    });

    controller.handleDone();
    await controller.awaitCompletion();

    expect(flushPendingSurfacedOutputs).toHaveBeenCalledTimes(1);
    expect(markCurrentAssistantPendingReview).toHaveBeenCalledWith({
      currentAssistantMessageId: 'assistant-1',
      visibleContent: 'Final answer',
    });
    expect(commitAssistantBuffers).toHaveBeenCalledTimes(1);
    expect(handleSuccessfulCompletion).toHaveBeenCalledTimes(1);
    expect(clearForegroundRequestIfCurrent).toHaveBeenCalledTimes(1);
  });

  it('routes caught failures through the failure finalizer and clears the draft', () => {
    const clearForegroundRequestIfCurrent = jest.fn();
    const clearStreamingDraft = jest.fn();
    const commitAssistantBuffers = jest.fn();
    const finalizeCaughtFailure = jest.fn();

    const controller = createForegroundRunTerminalLifecycleController({
      clearForegroundRequestIfCurrent,
      clearStreamingDraft,
      commitAssistantBuffers,
      completeOnce: async (task) => {
        await task();
      },
      ensureAssistantTurn: jest.fn(),
      finalizeCaughtAbort: jest.fn(),
      finalizeCaughtFailure,
      flushPendingSurfacedOutputs: jest.fn(),
      getCurrentAssistantMessageId: () => 'assistant-2',
      getVisibleAssistantContent: () => 'Broken answer',
      markCurrentAssistantPendingReview: jest.fn(),
      handleInterruptedError: jest.fn(),
      handleSuccessfulCompletion: jest.fn(),
      isAbortErrorLike: () => false,
      isAborted: () => false,
      requestPersistenceCheckpoint: jest.fn(),
    });

    controller.handleCatch(new Error('tool failed'));

    expect(commitAssistantBuffers).toHaveBeenCalledTimes(1);
    expect(clearStreamingDraft).toHaveBeenCalledWith('assistant-2');
    expect(finalizeCaughtFailure).toHaveBeenCalledWith({
      currentAssistantMessageId: 'assistant-2',
      errorMessage: 'tool failed',
      visibleContent: 'Broken answer',
    });
    expect(clearForegroundRequestIfCurrent).toHaveBeenCalledTimes(1);
  });

  it('routes caught aborts through the abort finalizer', () => {
    const finalizeCaughtAbort = jest.fn();

    const controller = createForegroundRunTerminalLifecycleController({
      clearForegroundRequestIfCurrent: jest.fn(),
      clearStreamingDraft: jest.fn(),
      commitAssistantBuffers: jest.fn(),
      completeOnce: async (task) => {
        await task();
      },
      ensureAssistantTurn: jest.fn(),
      finalizeCaughtAbort,
      finalizeCaughtFailure: jest.fn(),
      flushPendingSurfacedOutputs: jest.fn(),
      getCurrentAssistantMessageId: () => 'assistant-3',
      getVisibleAssistantContent: () => '',
      markCurrentAssistantPendingReview: jest.fn(),
      handleInterruptedError: jest.fn(),
      handleSuccessfulCompletion: jest.fn(),
      isAbortErrorLike: () => true,
      isAborted: () => false,
      requestPersistenceCheckpoint: jest.fn(),
    });

    controller.handleCatch(new Error('aborted'));

    expect(finalizeCaughtAbort).toHaveBeenCalledTimes(1);
  });
});

describe('foregroundRun terminal lifecycle helpers', () => {
  it('builds graph-owned incomplete assistant metadata', () => {
    expect(buildForegroundAssistantIncompleteMetadata('response_failed')).toEqual(
      expect.objectContaining({
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'response_failed',
      }),
    );
  });

  it('skips incomplete metadata when no visible content exists', () => {
    const updateMetadata = jest.fn();

    expect(
      applyForegroundAssistantDraftIncomplete({
        finishReason: 'response_failed',
        messageId: 'assistant-4',
        updateMetadata,
        visibleContent: '   ',
      }),
    ).toBe(false);
    expect(updateMetadata).not.toHaveBeenCalled();

    expect(
      applyForegroundAssistantDraftIncomplete({
        finishReason: 'terminal_review_pending',
        messageId: 'assistant-4',
        updateMetadata,
        visibleContent: 'Partial answer',
      }),
    ).toBe(true);
    expect(updateMetadata).toHaveBeenCalledWith(
      'assistant-4',
      expect.objectContaining({
        finishReason: 'terminal_review_pending',
      }),
    );
  });
});
