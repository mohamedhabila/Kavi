import { executeAgentControlGraphIteration } from '../../src/engine/graph/iterationExecution';
import type { ExecuteAgentControlGraphSessionParams } from '../../src/engine/graph/sessionExecution';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import { executeAgentControlGraphSession } from '../../src/engine/graph/sessionExecution';
import { emitSessionEvent } from '../../src/services/events/bus';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from '../../src/engine/graph/graphObservability';
import { buildRunStoppedMessage } from '../../src/engine/graph/runStoppedMessage';

jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/engine/graph/iterationExecution', () => ({
  executeAgentControlGraphIteration: jest.fn(),
}));

const mockedEmitSessionEvent = jest.mocked(emitSessionEvent);
const mockedExecuteAgentControlGraphIteration = jest.mocked(executeAgentControlGraphIteration);

function createParams(
  overrides: Partial<ExecuteAgentControlGraphSessionParams> = {},
): ExecuteAgentControlGraphSessionParams {
  return {
    allProviders: [],
    allTools: [],
    callbacks: {
      onAssistantMessage: jest.fn(),
      onStateChange: jest.fn(),
      onToken: jest.fn(),
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
      onToolMessage: jest.fn(),
    },
    compactionEngine: null,
    conversationId: 'conv-1',
    failoverState: null,
    graph: {
      applyAgentControlGraphEvents: jest.fn(),
      completedWorkflowToolNames: new Set<string>(),
      consumeOneShotTurnDirectives: jest.fn(),
      finishCancelled: jest.fn().mockResolvedValue(undefined),
      finishExistingTerminalSession: jest.fn().mockResolvedValue(undefined),
      finishFailure: jest.fn().mockResolvedValue(undefined),
      finishWithGraphFinalCandidateEvent: jest.fn().mockResolvedValue(undefined),
      finishWithGraphTerminalEvent: jest.fn().mockResolvedValue(undefined),
      getCurrentTurnDirectives: jest.fn().mockReturnValue({}),
      getGraphSnapshot: jest.fn().mockReturnValue(undefined),
      publishWorkflowToolResultProgressToAgentControlGraph: jest.fn(),
      recordPerformanceMetrics: jest.fn(),
      recordObservability: jest.fn(),
      recordPostToolFinalTextDirective: jest.fn().mockReturnValue(false),
      recordTurnDirectives: jest.fn(),
      resetIncompleteFinalTextRecovery: jest.fn(),
      syncPendingAsyncOperationsToGraph: jest.fn(),
    },
    initialRuntime: {
      activeModel: 'gpt-5-mini',
      activeProvider: { id: 'provider-1', name: 'OpenAI', enabled: true } as any,
      memory: { status: 'unavailable' },
      consecutivePendingAsyncNoToolTurns: 0,
      lastPendingAsyncSignature: '',
      llm: {} as any,
      warningInjectedThisRound: false,
      workingMessages: [],
    },
    maxToolIterations: 2,
    maxTokens: 8000,
    promptContextSupport: {
      maxToolIterations: 2,
      resolvedPrompt: '',
      skillPrompts: [],
    },
    reportUsage: jest.fn(),
    refreshSessionMemory: jest.fn(() => ({
      status: 'unavailable' as const,
    })),
    requestFrame: buildGraphEntryRequestFrame({
      text: 'Run the task',
      attachmentCount: 0,
      continuation: 'new',
    }),
    thinkingLevel: 'off',
    toolRuntime: {
      availableToolNames: new Set<string>(),
      runtimeToolAvailability: {} as any,
      toolCallHistory: [],
    },
    trackedAsyncOperations: new Map(),
    warn: jest.fn(),
    yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ExecuteAgentControlGraphSessionParams;
}

describe('agentControlGraphSessionExecution', () => {
  beforeEach(() => {
    mockedEmitSessionEvent.mockClear();
    mockedExecuteAgentControlGraphIteration.mockReset();
  });

  it('finishes immediately when the graph is already terminal before an iteration starts', async () => {
    const params = createParams();
    (params.graph.getGraphSnapshot as jest.Mock).mockReturnValue({
      status: 'finalized',
      terminalReason: 'restored_final_state',
    } as any);

    await executeAgentControlGraphSession(params);

    expect(mockedEmitSessionEvent).toHaveBeenCalledWith('start', { conversationId: 'conv-1' });
    expect(params.graph.finishExistingTerminalSession).toHaveBeenCalledWith('restored_final_state');
    expect(mockedExecuteAgentControlGraphIteration).not.toHaveBeenCalled();
  });

  it('finalizes with the max-iterations summary when iterations keep continuing', async () => {
    const params = createParams({ maxToolIterations: 1 });
    mockedExecuteAgentControlGraphIteration.mockResolvedValue({
      status: 'continued',
      runtime: params.initialRuntime,
    });

    await executeAgentControlGraphSession(params);

    expect(mockedExecuteAgentControlGraphIteration).toHaveBeenCalledTimes(1);
    expect(params.graph.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: buildRunStoppedMessage('step_limit'),
        graphEvent: {
          type: 'FINALIZED',
          reason: 'max_iterations',
        },
        sessionEndReason: 'max_iterations',
      }),
    );
  });

  it('extends a progressing default long-horizon run before its final-text-only turn', async () => {
    const params = createParams({
      allowLongHorizonIterationExtensions: true,
      maxToolIterations: 2,
    });
    params.toolRuntime.toolCallHistory.push(
      {
        name: 'read_file',
        arguments: '{"path":"input-a.txt"}',
        timestamp: 1,
        status: 'completed',
      },
      {
        name: 'read_file',
        arguments: '{"path":"input-b.txt"}',
        timestamp: 2,
        status: 'completed',
      },
    );
    mockedExecuteAgentControlGraphIteration
      .mockResolvedValueOnce({ status: 'continued', runtime: params.initialRuntime })
      .mockResolvedValueOnce({ status: 'continued', runtime: params.initialRuntime })
      .mockResolvedValueOnce({ status: 'finalized', runtime: params.initialRuntime });

    await executeAgentControlGraphSession(params);

    expect(mockedExecuteAgentControlGraphIteration).toHaveBeenCalledTimes(3);
    expect(
      mockedExecuteAgentControlGraphIteration.mock.calls.map(([input]) => ({
        iteration: input.iteration,
        maxToolIterations: input.maxToolIterations,
        promptMaxToolIterations: input.promptContextSupport.maxToolIterations,
      })),
    ).toEqual([
      { iteration: 1, maxToolIterations: 2, promptMaxToolIterations: 2 },
      { iteration: 2, maxToolIterations: 4, promptMaxToolIterations: 4 },
      { iteration: 3, maxToolIterations: 4, promptMaxToolIterations: 4 },
    ]);
    expect(params.graph.recordObservability).toHaveBeenCalledWith({
      observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.LONG_HORIZON_BUDGET_EXTENDED,
      iteration: 1,
      detail: 'from:2,to:4',
    });
    expect(params.graph.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
  });

  it('reads memory again for the next step once memory was turned on or off, leaving the thread as it is', async () => {
    const compactMessage = {
      id: 'compact_summary',
      role: 'system' as const,
      content: 'ملخص قديم 以前の要約',
      timestamp: 1,
    };
    const arabicMessage = {
      id: 'user-ar',
      role: 'user' as const,
      content: 'تابع المهمة باستخدام تفضيلاتي الجديدة',
      timestamp: 2,
    };
    const params = createParams({ maxToolIterations: 1 });
    params.initialRuntime.workingMessages = [compactMessage, arabicMessage];
    // Read while memory was off; it is on now, so the read is no longer current.
    params.initialRuntime.memory = { status: 'off' };
    const refreshed = { status: 'read' as const, section: null };
    jest.mocked(params.refreshSessionMemory).mockReturnValueOnce(refreshed);
    mockedExecuteAgentControlGraphIteration.mockResolvedValueOnce({
      status: 'finalized',
      runtime: params.initialRuntime,
    });

    await executeAgentControlGraphSession(params);

    expect(params.refreshSessionMemory).toHaveBeenCalledTimes(1);
    expect(params.refreshSessionMemory).toHaveBeenCalledWith([compactMessage, arabicMessage]);
    expect(mockedExecuteAgentControlGraphIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        iteration: 1,
        runtime: expect.objectContaining({
          memory: refreshed,
          workingMessages: [compactMessage, arabicMessage],
        }),
      }),
    );
  });

  it('keeps a current memory read for the next step', async () => {
    const params = createParams({ maxToolIterations: 1 });
    params.initialRuntime.memory = { status: 'read', section: null };
    mockedExecuteAgentControlGraphIteration.mockResolvedValueOnce({
      status: 'finalized',
      runtime: params.initialRuntime,
    });

    await executeAgentControlGraphSession(params);

    expect(params.refreshSessionMemory).not.toHaveBeenCalled();
  });

  it('preserves the original failure when failure finalization rejects', async () => {
    const originalError = new Error('model turn failed');
    const finalizationError = new Error('finalization failed');
    const params = createParams();
    mockedExecuteAgentControlGraphIteration.mockRejectedValueOnce(originalError);
    (params.graph.finishFailure as jest.Mock).mockRejectedValueOnce(finalizationError);

    await expect(executeAgentControlGraphSession(params)).rejects.toBe(originalError);

    expect(params.graph.finishFailure).toHaveBeenCalledWith(originalError);
    expect(params.warn).toHaveBeenCalledWith(
      'Agent control graph failure finalization failed',
      finalizationError,
    );
  });

  describe('steering', () => {
    const request = {
      id: 'request',
      role: 'user' as const,
      content: 'Plan a dinner.',
      timestamp: 1,
    };
    const toolResult = {
      id: 'result',
      role: 'tool' as const,
      toolCallId: 'call-1',
      content: 'ok',
      timestamp: 2,
    };
    const steer = {
      id: 'steer',
      role: 'user' as const,
      content: 'Make it vegetarian.',
      timestamp: 3,
      steerOfRunId: 'run-1',
    };

    it('gives the next step the messages that steered the run since the last one', async () => {
      const takeSteeringMessages = jest
        .fn()
        .mockReturnValueOnce([])
        .mockReturnValueOnce([steer])
        .mockReturnValue([]);
      const params = createParams({ maxToolIterations: 3 });
      params.callbacks.takeSteeringMessages = takeSteeringMessages;
      params.initialRuntime.workingMessages = [request];
      (params.toolRuntime as { currentUserMessage?: unknown }).currentUserMessage = {
        id: 'request',
        text: 'Plan a dinner.',
      };
      mockedExecuteAgentControlGraphIteration
        .mockImplementationOnce(async ({ runtime }) => ({
          status: 'continued',
          runtime: { ...runtime, workingMessages: [...runtime.workingMessages, toolResult] },
        }))
        .mockImplementationOnce(async ({ runtime }) => ({ status: 'finalized', runtime }));

      await executeAgentControlGraphSession(params);

      const [first, second] = mockedExecuteAgentControlGraphIteration.mock.calls.map(
        ([input]) => input,
      );
      expect(first!.runtime.workingMessages).toEqual([request]);
      expect(first!.toolRuntime.currentUserMessage).toEqual({
        id: 'request',
        text: 'Plan a dinner.',
      });
      expect(second!.runtime.workingMessages).toEqual([request, toolResult, steer]);
      expect(second!.toolRuntime.currentUserMessage).toEqual({
        id: 'steer',
        text: 'Make it vegetarian.',
        earlierInTurn: [{ id: 'request', text: 'Plan a dinner.' }],
      });
      expect(second!.toolRuntime.toolCallHistory).toBe(params.toolRuntime.toolCallHistory);
      expect(params.graph.recordObservability).toHaveBeenCalledWith({
        observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.STEERING_DELIVERED,
        iteration: 2,
        detail: 'count:1',
      });
    });

    it('runs unchanged when the run cannot be steered', async () => {
      const params = createParams({ maxToolIterations: 2 });
      params.initialRuntime.workingMessages = [request];
      mockedExecuteAgentControlGraphIteration
        .mockImplementationOnce(async ({ runtime }) => ({ status: 'continued', runtime }))
        .mockImplementationOnce(async ({ runtime }) => ({ status: 'finalized', runtime }));

      await executeAgentControlGraphSession(params);

      for (const [input] of mockedExecuteAgentControlGraphIteration.mock.calls) {
        expect(input.toolRuntime).toBe(params.toolRuntime);
        expect(input.runtime.workingMessages).toEqual([request]);
      }
      expect(params.graph.recordObservability).not.toHaveBeenCalledWith(
        expect.objectContaining({
          observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.STEERING_DELIVERED,
        }),
      );
    });
  });
});
