import { handleForegroundRunCompletionFlow } from '../../src/engine/graph/foregroundRun/completionFlow';
import type { ForegroundRunTrackingState } from '../../src/engine/graph/foregroundRun/trackingState';

function createTrackingState(
  overrides: Partial<ForegroundRunTrackingState> = {},
): ForegroundRunTrackingState {
  return {
    backgroundWorkers: {
      runningLiveCount: 0,
      orphanedRunningCount: 0,
      outstandingSpawnedCount: 0,
    },
    pendingAsyncOperations: [],
    isRunning: true,
    ...overrides,
  };
}

describe('foregroundRun completion flow', () => {
  it('finalizes normally when only detached background workers remain', async () => {
    const appendConversationLog = jest.fn();
    const enterAsyncMonitoringPhase = jest.fn();
    const finalizeCompletion = jest.fn().mockReturnValue(true);
    const reviewCompletion = jest.fn().mockResolvedValue({
      handled: false as const,
      completionStatus: 'completed' as const,
      latestSummary: 'Turn completed',
      checkpointTitle: 'Turn completed',
      checkpointDetail: 'Turn completed',
      completionLogLevel: 'success' as const,
      completionLogTitle: 'Turn completed',
      completionLogDetail: 'Turn completed',
    });

    await handleForegroundRunCompletionFlow({
      appendConversationLog,
      currentAssistantMessage: {
        role: 'assistant',
        content: 'I am waiting for the worker to finish.',
        toolCalls: [],
      },
      currentAssistantMessageId: 'assistant-1',
      enterAsyncMonitoringPhase,
      finalizeCompletion,
      reviewCompletion,
      trackedRunState: createTrackingState({
        backgroundWorkers: {
          runningLiveCount: 1,
          orphanedRunningCount: 0,
          outstandingSpawnedCount: 1,
        },
      }),
      turnSummary: 'Turn summary',
    });

    expect(reviewCompletion).toHaveBeenCalledTimes(1);
    expect(finalizeCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        completionStatus: 'completed',
        checkpointTitle: 'Turn completed',
      }),
    );
    expect(enterAsyncMonitoringPhase).not.toHaveBeenCalled();
  });

  it('finalizes an ordinary completed assistant answer without background-specific handling', async () => {
    const appendConversationLog = jest.fn();
    const enterAsyncMonitoringPhase = jest.fn();
    const finalizeCompletion = jest.fn().mockReturnValue(true);
    const reviewCompletion = jest.fn().mockResolvedValue({
      handled: false as const,
      completionStatus: 'completed' as const,
      latestSummary: 'Worker started',
      checkpointTitle: 'Turn completed',
      checkpointDetail: 'Worker started',
      completionLogLevel: 'success' as const,
      completionLogTitle: 'Turn completed',
      completionLogDetail: 'Worker started',
    });

    await handleForegroundRunCompletionFlow({
      appendConversationLog,
      currentAssistantMessage: {
        role: 'assistant',
        content: 'STARTED_BGSTATE0607',
        toolCalls: [],
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
      currentAssistantMessageId: 'assistant-1',
      enterAsyncMonitoringPhase,
      finalizeCompletion,
      reviewCompletion,
      trackedRunState: createTrackingState({
        backgroundWorkers: {
          runningLiveCount: 1,
          orphanedRunningCount: 0,
          outstandingSpawnedCount: 1,
        },
      }),
      turnSummary: 'Turn summary',
    });

    expect(enterAsyncMonitoringPhase).not.toHaveBeenCalled();
    expect(reviewCompletion).toHaveBeenCalledTimes(1);
    expect(finalizeCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        completionStatus: 'completed',
        checkpointTitle: 'Turn completed',
      }),
    );
  });

  it('keeps the run open for async monitoring without triggering review', async () => {
    const appendConversationLog = jest.fn();
    const enterAsyncMonitoringPhase = jest.fn();
    const finalizeCompletion = jest.fn().mockReturnValue(true);
    const reviewCompletion = jest.fn();

    await handleForegroundRunCompletionFlow({
      appendConversationLog,
      currentAssistantMessage: undefined,
      currentAssistantMessageId: 'assistant-1',
      enterAsyncMonitoringPhase,
      finalizeCompletion,
      reviewCompletion,
      trackedRunState: createTrackingState({
        pendingAsyncOperations: [
          {
            key: 'async-1',
            kind: 'expo-workflow',
            resourceId: 'workflow-1',
            displayName: 'Deploy run',
            status: 'running',
            lastUpdatedByTool: 'workflow_status',
            updatedAt: Date.now(),
            monitorToolNames: ['workflow_status'],
          },
        ],
      }),
      turnSummary: 'Turn summary',
    });

    expect(enterAsyncMonitoringPhase).toHaveBeenCalledWith(
      'Waiting for Deploy run to finish.',
      'Async monitoring active',
    );
    expect(appendConversationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Async monitoring still active',
        detail: 'Turn summary · Waiting for Deploy run to finish.',
      }),
    );
    expect(finalizeCompletion).not.toHaveBeenCalled();
    expect(reviewCompletion).not.toHaveBeenCalled();
  });

  it('forces terminal review for a failed graph even while async work remains', async () => {
    const enterAsyncMonitoringPhase = jest.fn();
    const reviewCompletion = jest.fn().mockResolvedValue({
      handled: true as const,
      terminalized: true,
    });

    await handleForegroundRunCompletionFlow({
      appendConversationLog: jest.fn(),
      currentAssistantMessage: undefined,
      currentAssistantMessageId: 'assistant-failed',
      enterAsyncMonitoringPhase,
      forceTerminalReview: true,
      finalizeCompletion: jest.fn(),
      reviewCompletion,
      trackedRunState: createTrackingState({
        pendingAsyncOperations: [
          {
            key: 'async-failed',
            kind: 'expo-workflow',
            resourceId: 'workflow-failed',
            displayName: 'Failed deploy run',
            status: 'running',
            lastUpdatedByTool: 'workflow_status',
            updatedAt: Date.now(),
            monitorToolNames: ['workflow_status'],
          },
        ],
      }),
      turnSummary: 'Graph failed',
    });

    expect(reviewCompletion).toHaveBeenCalledTimes(1);
    expect(enterAsyncMonitoringPhase).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'returns without duplicate finalization when completion review handled the run (terminalized=%s)',
    async (terminalized) => {
      const appendConversationLog = jest.fn();
      const finalizeCompletion = jest.fn();

      await handleForegroundRunCompletionFlow({
        appendConversationLog,
        currentAssistantMessage: undefined,
        currentAssistantMessageId: 'assistant-1',
        enterAsyncMonitoringPhase: jest.fn(),
        finalizeCompletion,
        reviewCompletion: jest.fn().mockResolvedValue({
          handled: true as const,
          terminalized,
        }),
        trackedRunState: createTrackingState(),
        turnSummary: terminalized ? 'Turn failed' : 'Run continuing',
      });

      expect(finalizeCompletion).not.toHaveBeenCalled();
      expect(appendConversationLog).not.toHaveBeenCalled();
    },
  );

  it('finalizes the run after review when no open work remains', async () => {
    const appendConversationLog = jest.fn();
    const enterAsyncMonitoringPhase = jest.fn();
    const finalizeCompletion = jest.fn().mockReturnValue(true);
    const reviewCompletion = jest.fn().mockResolvedValue({
      handled: false as const,
      completionStatus: 'completed' as const,
      latestSummary: 'Turn completed',
      checkpointTitle: 'Turn completed',
      checkpointDetail: 'Turn completed',
      completionLogLevel: 'success' as const,
      completionLogTitle: 'Turn completed',
      completionLogDetail: 'Turn completed',
    });

    await handleForegroundRunCompletionFlow({
      appendConversationLog,
      currentAssistantMessage: undefined,
      currentAssistantMessageId: 'assistant-1',
      enterAsyncMonitoringPhase,
      finalizeCompletion,
      reviewCompletion,
      trackedRunState: createTrackingState(),
      turnSummary: 'Turn summary',
    });

    expect(reviewCompletion).toHaveBeenCalledTimes(1);
    expect(finalizeCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        completionStatus: 'completed',
        checkpointTitle: 'Turn completed',
      }),
    );
    expect(appendConversationLog).toHaveBeenCalledWith({
      kind: 'state',
      level: 'success',
      title: 'Turn completed',
      detail: 'Turn completed',
    });
    expect(enterAsyncMonitoringPhase).not.toHaveBeenCalled();
  });

  it('does not log success when the completion boundary rejects terminalization', async () => {
    const appendConversationLog = jest.fn();
    const finalizeCompletion = jest.fn().mockReturnValue(false);

    await handleForegroundRunCompletionFlow({
      appendConversationLog,
      currentAssistantMessage: undefined,
      currentAssistantMessageId: 'assistant-1',
      enterAsyncMonitoringPhase: jest.fn(),
      finalizeCompletion,
      reviewCompletion: jest.fn().mockResolvedValue({
        handled: false as const,
        completionStatus: 'completed' as const,
        latestSummary: 'Unsettled result',
        checkpointTitle: 'Turn completed',
        checkpointDetail: 'Turn completed',
        completionLogLevel: 'success' as const,
        completionLogTitle: 'Turn completed',
        completionLogDetail: 'Turn completed',
      }),
      trackedRunState: createTrackingState(),
      turnSummary: 'Turn summary',
    });

    expect(finalizeCompletion).toHaveBeenCalledTimes(1);
    expect(appendConversationLog).not.toHaveBeenCalled();
  });
});
