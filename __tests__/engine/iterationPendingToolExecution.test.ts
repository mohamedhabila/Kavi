import { executePreparedAgentControlGraphPendingToolTurn } from '../../src/engine/graph/iterationPendingToolExecution';
import { executeAgentControlGraphToolTurn } from '../../src/engine/graph/toolTurnExecution';

jest.mock('../../src/engine/graph/toolTurnExecution', () => ({
  executeAgentControlGraphToolTurn: jest.fn(),
}));

const mockedExecuteAgentControlGraphToolTurn = jest.mocked(executeAgentControlGraphToolTurn);

function createParams(overrides: Record<string, unknown> = {}) {
  return {
    iterationParams: {
      iteration: 3,
      maxToolIterations: 8,
      conversationId: 'conv-1',
      allTools: [{ name: 'write_file' }, { name: 'file_edit' }, { name: 'web_search' }],
      allProviders: undefined,
      trackedAsyncOperations: new Map(),
      signal: undefined,
      callbacks: {
        onAssistantMessage: jest.fn(),
        onToolCallStart: jest.fn(),
        onToolCallComplete: jest.fn(),
        onToolMessage: jest.fn(),
        onStateChange: jest.fn(),
      },
      toolRuntime: {
        availableToolNames: new Set(['write_file', 'file_edit', 'web_search']),
        runtimeToolAvailability: {
          hasWorkspaceTargets: false,
          hasBrowserControllableWorkspaceTargets: false,
          hasDelegableWorkspaceTargets: false,
        },
        toolCallHistory: [],
        toolFilter: undefined,
        workspaceConversationId: undefined,
        workspaceReadFallbackConversationId: undefined,
      },
      compactionEngine: null,
      livingMemory: null,
      onCompaction: undefined,
      warn: jest.fn(),
      yieldToUiFrame: jest.fn(),
      graph: {
        resetIncompleteFinalTextRecovery: jest.fn(),
        getGraphSnapshot: jest.fn(() => ({ status: 'ready' })),
        completedWorkflowToolNames: new Set<string>(),
        applyAgentControlGraphEvents: jest.fn(),
        publishWorkflowToolResultProgressToAgentControlGraph: jest.fn(),
        syncPendingAsyncOperationsToGraph: jest.fn(),
        recordTurnDirectives: jest.fn(),
        recordPostToolFinalTextDirective: jest.fn(() => false),
        finishWithGraphTerminalEvent: jest.fn(),
        recordPerformanceMetrics: jest.fn(),
      },
      emitPendingAsyncOperationsChange: jest.fn(),
    },
    modelTurnPreparation: {
      pendingAsyncMonitorToolNames: new Set<string>(),
      preparedTurn: {
        selectedTools: [{ name: 'write_file' }, { name: 'file_edit' }],
        toolsForIteration: [{ name: 'write_file' }, { name: 'file_edit' }],
      },
    },
    runtime: {
      consecutivePendingAsyncNoToolTurns: 0,
      activeProvider: { id: 'provider-1' },
      activeModel: 'gemini-3.5-flash',
      lastPendingAsyncSignature: '',
      warningInjectedThisRound: false,
      workingMessages: [],
    },
    contextWindow: 0,
    turnAssistantContent: '',
    reasoning: '',
    providerReplay: undefined,
    completion: undefined,
    pendingToolCalls: [
      {
        id: 'gemini-call-0',
        name: 'web_search',
        arguments: '{"queries":["wrong"]}',
      },
    ],
    ...overrides,
  } as any;
}

describe('iterationPendingToolExecution', () => {
  beforeEach(() => {
    mockedExecuteAgentControlGraphToolTurn.mockReset();
    mockedExecuteAgentControlGraphToolTurn.mockResolvedValue({
      status: 'continued',
      lastPendingAsyncSignature: '',
      warningInjectedThisRound: false,
      workingMessages: [],
    });
  });

  it('passes the runtime tool filter through unchanged', async () => {
    const runtimeToolFilter = jest.fn((toolName: string) => toolName !== 'file_edit');

    await executePreparedAgentControlGraphPendingToolTurn(
      createParams({
        iterationParams: {
          ...createParams().iterationParams,
          toolRuntime: {
            ...createParams().iterationParams.toolRuntime,
            toolFilter: runtimeToolFilter,
          },
        },
      }),
    );

    const toolFilter = mockedExecuteAgentControlGraphToolTurn.mock.calls[0]?.[0]?.toolFilter;
    expect(toolFilter).toBe(runtimeToolFilter);
  });

  it('passes the prepared selected tool surface into tool execution', async () => {
    await executePreparedAgentControlGraphPendingToolTurn(createParams());

    const groundedRequestScopedTools =
      mockedExecuteAgentControlGraphToolTurn.mock.calls[0]?.[0]?.groundedRequestScopedTools;
    expect(groundedRequestScopedTools?.map((tool: { name: string }) => tool.name)).toEqual([
      'write_file',
      'file_edit',
    ]);
  });
});
