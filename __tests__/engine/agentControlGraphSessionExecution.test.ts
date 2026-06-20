import { executeAgentControlGraphIteration } from '../../src/engine/graph/iterationExecution';
import type { ExecuteAgentControlGraphSessionParams } from '../../src/engine/graph/sessionExecution';
import { executeAgentControlGraphSession } from '../../src/engine/graph/sessionExecution';
import { emitSessionEvent } from '../../src/services/events/bus';

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
      recordPostToolFinalTextDirective: jest.fn().mockReturnValue(false),
      recordTurnDirectives: jest.fn(),
      resetIncompleteFinalTextRecovery: jest.fn(),
      syncPendingAsyncOperationsToGraph: jest.fn(),
    },
    initialRuntime: {
      activeModel: 'gpt-5-mini',
      activeProvider: { id: 'provider-1', name: 'OpenAI', enabled: true } as any,
      consecutivePendingAsyncNoToolTurns: 0,
      lastPendingAsyncSignature: '',
      llm: {} as any,
      warningInjectedThisRound: false,
      workingMessages: [],
    },
    isSuperAgent: true,
    latestUserMessageText: '',
    maxToolIterations: 2,
    maxTokens: 8000,
    promptContextSupport: {
      conversationMemory: '',
      globalMemory: '',
      livingMemorySections: [],
      maxToolIterations: 2,
      resolvedPrompt: '',
      skillPrompts: [],
    },
    reportUsage: jest.fn(),
    requestAction: 'continue',
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
    expect(params.graph.finishExistingTerminalSession).toHaveBeenCalledWith(
      'restored_final_state',
    );
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
        content:
          "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.",
        graphEvent: {
          type: 'FINALIZED',
          reason: 'max_iterations',
        },
        sessionEndReason: 'max_iterations',
      }),
    );
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
});
