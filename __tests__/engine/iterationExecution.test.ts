import { executeAgentControlGraphIteration } from '../../src/engine/graph/iterationExecution';
import { prepareAgentControlGraphModelTurn } from '../../src/engine/graph/prepareAgentControlGraphModelTurn';
import { executePreparedAgentControlGraphTurn } from '../../src/engine/graph/iterationReadyTurnExecution';

jest.mock('../../src/engine/graph/prepareAgentControlGraphModelTurn', () => ({
  prepareAgentControlGraphModelTurn: jest.fn(),
}));

jest.mock('../../src/engine/graph/iterationReadyTurnExecution', () => ({
  executePreparedAgentControlGraphTurn: jest.fn(),
}));

const mockedPrepareModelTurn = jest.mocked(prepareAgentControlGraphModelTurn);
const mockedExecutePreparedTurn = jest.mocked(executePreparedAgentControlGraphTurn);

function params(iteration: number) {
  const runtime = {
    activeModel: 'test-model',
    activeProvider: { id: 'provider', name: 'Provider', enabled: true },
    memory: { status: 'off' },
    consecutivePendingAsyncNoToolTurns: 0,
    lastPendingAsyncSignature: '',
    llm: {},
    warningInjectedThisRound: false,
    workingMessages: [],
  };
  const graph = {
    applyAgentControlGraphEvents: jest.fn(),
    completedWorkflowToolNames: new Set<string>(),
    consumeOneShotTurnDirectives: jest.fn(),
    finishCancelled: jest.fn(),
    finishExistingTerminalSession: jest.fn(),
    finishFailure: jest.fn(),
    finishWithGraphFinalCandidateEvent: jest.fn(),
    finishWithGraphTerminalEvent: jest.fn(),
    getCurrentTurnDirectives: jest.fn().mockReturnValue({
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    }),
    getGraphSnapshot: jest.fn().mockReturnValue({}),
    publishWorkflowToolResultProgressToAgentControlGraph: jest.fn(),
    recordPerformanceMetrics: jest.fn(),
    recordObservability: jest.fn(),
    recordPostToolFinalTextDirective: jest.fn(),
    recordTurnDirectives: jest.fn(),
    resetIncompleteFinalTextRecovery: jest.fn(),
    syncPendingAsyncOperationsToGraph: jest.fn(),
  };
  return {
    allTools: [],
    callbacks: {},
    compactionEngine: null,
    conversationId: 'conversation',
    failoverState: null,
    graph,
    iteration,
    latestUserMessageText: 'PRIVATE-REQUEST-TEXT-NEVER-PROJECT',
    maxToolIterations: 4,
    maxTokens: 4096,
    promptContextSupport: {
      maxToolIterations: 4,
      resolvedPrompt: 'System prompt',
      runtimeContext: 'Runtime context',
      skillPrompts: '',
    },
    reportUsage: jest.fn(),
    runtime,
    thinkingLevel: 'off',
    toolRuntime: {
      availableToolNames: new Set<string>(),
      catalogVisibleToolNames: new Set<string>(),
      memoryConversationId: 'conversation',
      runtimeToolAvailability: {},
      toolCallHistory: [],
      stagnationSignatures: [],
    },
    trackedAsyncOperations: new Map(),
    warn: jest.fn(),
    yieldToUiFrame: jest.fn(),
  } as any;
}

describe('agent control graph iteration', () => {
  beforeEach(() => {
    mockedPrepareModelTurn.mockReset();
    mockedExecutePreparedTurn.mockReset();
    mockedPrepareModelTurn.mockResolvedValue({} as never);
    mockedExecutePreparedTurn.mockImplementation(async ({ runtime }) => ({
      runtime,
      status: 'continued',
    }));
  });

  // Every iteration used to project a request-routing summary into the graph, an event and an
  // audit entry that nothing read.
  it('writes nothing to the graph of its own before the model turn', async () => {
    const input = params(2);
    await executeAgentControlGraphIteration(input);

    expect(input.graph.applyAgentControlGraphEvents).not.toHaveBeenCalled();
    expect(mockedPrepareModelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        promptContextSupport: expect.objectContaining({ runtimeContext: 'Runtime context' }),
      }),
    );
  });

  it("reads the run's plan from the graph on every iteration", async () => {
    const input = params(2);
    const plan = [
      { step: 'Find flights', status: 'completed' },
      { step: 'Book the hotel', status: 'in_progress' },
    ];
    input.graph.getGraphSnapshot.mockReturnValue({ plan });

    await executeAgentControlGraphIteration(input);

    expect(mockedPrepareModelTurn.mock.calls[0]?.[0].promptContextSupport.graphPlan).toEqual(plan);
  });
});
