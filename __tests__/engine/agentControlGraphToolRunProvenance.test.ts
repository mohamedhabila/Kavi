jest.mock('../../src/engine/graph/toolTurnExecution', () => ({
  executeAgentControlGraphToolTurn: jest.fn().mockResolvedValue({
    status: 'continued',
    workingMessages: [],
    lastPendingAsyncSignature: 'next-signature',
    warningInjectedThisRound: false,
  }),
}));

import { executePreparedAgentControlGraphPendingToolTurn } from '../../src/engine/graph/iterationPendingToolExecution';
import { executeAgentControlGraphToolTurn } from '../../src/engine/graph/toolTurnExecution';

const executeToolTurnMock = executeAgentControlGraphToolTurn as jest.MockedFunction<
  typeof executeAgentControlGraphToolTurn
>;

describe('agent control graph tool run provenance', () => {
  beforeEach(() => {
    executeToolTurnMock.mockClear();
  });

  it('forwards the tracked agent run id into pending tool execution', async () => {
    await executePreparedAgentControlGraphPendingToolTurn({
      iterationParams: {
        agentRunId: 'run-provenance',
        allProviders: [],
        callbacks: {
          onAssistantMessage: jest.fn(),
          onStateChange: jest.fn(),
          onToken: jest.fn(),
          onToolCallStart: jest.fn(),
          onToolCallComplete: jest.fn(),
          onToolMessage: jest.fn(),
        },
        compactionEngine: null,
        conversationId: 'conv-provenance',
        emitPendingAsyncOperationsChange: jest.fn(),
        graph: {
          applyAgentControlGraphEvents: jest.fn(),
          completedWorkflowToolNames: new Set(),
          consumeOneShotTurnDirectives: jest.fn(),
          finishCancelled: jest.fn(),
          finishExistingTerminalSession: jest.fn(),
          finishFailure: jest.fn(),
          finishWithGraphFinalCandidateEvent: jest.fn(),
          finishWithGraphTerminalEvent: jest.fn(),
          getCurrentTurnDirectives: jest.fn(),
          getGraphSnapshot: jest.fn(() => ({ goals: [] })),
          publishWorkflowToolResultProgressToAgentControlGraph: jest.fn(),
          recordObservability: jest.fn(),
          recordPerformanceMetrics: jest.fn(),
          recordPostToolFinalTextDirective: jest.fn(),
          recordTurnDirectives: jest.fn(),
          resetIncompleteFinalTextRecovery: jest.fn(),
          syncPendingAsyncOperationsToGraph: jest.fn(),
        },
        iteration: 1,
        maxToolIterations: 4,
        toolRuntime: {
          availableToolNames: new Set(['memory_remember']),
          runtimeToolAvailability: { availableToolNames: new Set(['memory_remember']) },
          toolCallHistory: [],
          stagnationSignatures: [],
        },
        trackedAsyncOperations: new Map(),
        yieldToUiFrame: jest.fn(),
        warn: jest.fn(),
      } as never,
      modelTurnPreparation: {
        pendingAsyncMonitorToolNames: new Set(),
        preparedTurn: {
          selectedTools: [],
        },
      } as never,
      runtime: {
        activeProvider: {
          id: 'provider',
          name: 'Provider',
          baseUrl: 'https://example.test',
          apiKey: 'key',
          model: 'model',
          enabled: true,
        },
        activeModel: 'model',
        consecutivePendingAsyncNoToolTurns: 0,
        lastPendingAsyncSignature: '',
        llm: {} as never,
        warningInjectedThisRound: false,
        workingMessages: [],
      },
      contextWindow: 128_000,
      turnAssistantContent: '',
      reasoning: '',
      pendingToolCalls: [
        {
          id: 'tc-1',
          name: 'memory_remember',
          arguments: JSON.stringify({ subject: 'project', predicate: 'status', value: 'green' }),
        },
      ],
    });

    expect(executeToolTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRunId: 'run-provenance',
      }),
    );
  });
});
