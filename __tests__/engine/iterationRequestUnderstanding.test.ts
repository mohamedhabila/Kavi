import { executeAgentControlGraphIteration } from '../../src/engine/graph/iterationExecution';
import { prepareAgentControlGraphModelTurn } from '../../src/engine/graph/prepareAgentControlGraphModelTurn';
import { executePreparedAgentControlGraphTurn } from '../../src/engine/graph/iterationReadyTurnExecution';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import { createGoal } from '../../src/engine/goals/types';
import {
  projectRequestUnderstanding,
  summarizeRequestUnderstanding,
} from '../../src/services/agents/requestUnderstandingProjection';

jest.mock('../../src/engine/graph/prepareAgentControlGraphModelTurn', () => ({
  prepareAgentControlGraphModelTurn: jest.fn(),
}));

jest.mock('../../src/engine/graph/iterationReadyTurnExecution', () => ({
  executePreparedAgentControlGraphTurn: jest.fn(),
}));

const mockedPrepareModelTurn = jest.mocked(prepareAgentControlGraphModelTurn);
const mockedExecutePreparedTurn = jest.mocked(executePreparedAgentControlGraphTurn);

function params(
  iteration: number,
  goals = [
    createGoal({
      id: 'current-goal',
      title: 'Keep the verified constraint',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:write_file'],
      now: 1,
    }),
  ],
) {
  const runtime = {
    activeModel: 'test-model',
    activeProvider: { id: 'provider', name: 'Provider', enabled: true },
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
    getGraphSnapshot: jest.fn().mockReturnValue({ goals }),
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
    isSuperAgent: true,
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
    requestFrame: buildGraphEntryRequestFrame({
      text: 'PRIVATE-REQUEST-TEXT-NEVER-PROJECT',
      attachmentCount: 0,
      mode: 'agentic',
      continuation: 'new',
    }),
    runtime,
    thinkingLevel: 'off',
    toolRuntime: {
      availableToolNames: new Set<string>(),
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

describe('iteration request understanding continuity', () => {
  beforeEach(() => {
    mockedPrepareModelTurn.mockReset();
    mockedExecutePreparedTurn.mockReset();
    mockedPrepareModelTurn.mockResolvedValue({} as never);
    mockedExecutePreparedTurn.mockImplementation(async ({ runtime }) => ({
      runtime,
      status: 'continued',
    }));
  });

  it('uses current graph goals and projects their criteria on a later iteration', async () => {
    const input = params(2);
    await executeAgentControlGraphIteration(input);

    expect(input.graph.applyAgentControlGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'REQUEST_UNDERSTANDING_PROJECTED',
        iteration: 2,
        projection: expect.objectContaining({
          version: 2,
          integrity: 'valid',
          declaredObjectives: { status: 'known', count: 1, omittedCount: 0 },
          structuredSuccessConditions: { status: 'known', count: 1, omittedCount: 0 },
          userConstraints: { status: 'unknown', count: 0, omittedCount: 0 },
          effectAuthorization: { status: 'unknown' },
        }),
      }),
    ]);
    expect(mockedPrepareModelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        goals: input.graph.getGraphSnapshot().goals,
        promptContextSupport: expect.objectContaining({
          graphGoals: input.graph.getGraphSnapshot().goals,
          runtimeContext: expect.stringContaining('## Request Understanding Projection (v2)'),
        }),
      }),
    );
    const preparation = mockedPrepareModelTurn.mock.calls[0]?.[0];
    expect(preparation?.promptContextSupport.runtimeContext).toContain('evidence.tool:write_file');
    expect(preparation?.promptContextSupport.runtimeContext).not.toContain(
      'PRIVATE-REQUEST-TEXT-NEVER-PROJECT',
    );
  });

  it('records a typed summary without adding prompt noise to a simple first turn', async () => {
    const input = params(1, []);
    await executeAgentControlGraphIteration(input);

    expect(input.graph.applyAgentControlGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'REQUEST_UNDERSTANDING_PROJECTED',
        projection: expect.objectContaining({
          declaredObjectives: { status: 'unknown', count: 0, omittedCount: 0 },
        }),
      }),
    ]);
    expect(mockedPrepareModelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        promptContextSupport: expect.objectContaining({
          graphGoals: [],
          runtimeContext: 'Runtime context',
        }),
      }),
    );
  });

  it('preserves an exact structured user constraint on a later iteration', async () => {
    const goal = createGoal({
      id: 'constraint-goal',
      title: 'Respect the user constraint',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:write_file'],
      userConstraints: [
        {
          text: 'Do not notify anyone before I review the draft.',
          sourceMessageId: 'private-source-message-id',
        },
      ],
      now: 1,
    });
    const input = params(3, [goal]);

    await executeAgentControlGraphIteration(input);

    expect(input.graph.applyAgentControlGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'REQUEST_UNDERSTANDING_PROJECTED',
        iteration: 3,
        projection: expect.objectContaining({
          userConstraints: { status: 'known', count: 1, omittedCount: 0 },
        }),
      }),
    ]);
    const preparation = mockedPrepareModelTurn.mock.calls[0]?.[0];
    expect(preparation?.promptContextSupport.runtimeContext).toContain(
      'status=known; count=1; omitted=0',
    );
    expect(preparation?.promptContextSupport.runtimeContext).not.toContain(
      'Do not notify anyone before I review the draft.',
    );
    expect(preparation?.promptContextSupport.runtimeContext).not.toContain(
      'private-source-message-id',
    );
    expect(preparation?.promptContextSupport.graphGoals?.[0]?.userConstraints).toEqual(
      goal.userConstraints,
    );
  });

  it('does not write an unchanged projection again', async () => {
    const input = params(3);
    const goals = input.graph.getGraphSnapshot().goals;
    input.graph.getGraphSnapshot.mockReturnValue({
      goals,
      requestUnderstanding: summarizeRequestUnderstanding(
        projectRequestUnderstanding({ requestFrame: input.requestFrame, goals }),
      ),
    });

    await executeAgentControlGraphIteration(input);

    expect(input.graph.applyAgentControlGraphEvents).not.toHaveBeenCalled();
    expect(mockedPrepareModelTurn).toHaveBeenCalledWith(expect.objectContaining({ goals }));
  });
});
