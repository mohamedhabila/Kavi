import { executePreparedAgentControlGraphPendingToolTurn } from '../../src/engine/graph/iterationPendingToolExecution';
import type { ModelTurnMemoryPolicyBinding } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { executeAgentControlGraphToolTurn } from '../../src/engine/graph/toolTurnExecution';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

jest.mock('../../src/engine/graph/toolTurnExecution', () => ({
  executeAgentControlGraphToolTurn: jest.fn(),
}));

const mockedExecuteAgentControlGraphToolTurn = jest.mocked(executeAgentControlGraphToolTurn);
const MEMORY_POLICY_BINDING_SENTINEL: ModelTurnMemoryPolicyBinding = Object.freeze({
  kind: 'policy_independent',
});

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
      admittedMemoryContext: { livingMemory: null },
      consecutivePendingAsyncNoToolTurns: 0,
      activeProvider: { id: 'provider-1' },
      activeModel: 'gemini-3.5-flash',
      lastPendingAsyncSignature: '',
      lastModelTurnMemoryPolicyBinding: MEMORY_POLICY_BINDING_SENTINEL,
      warningInjectedThisRound: false,
      workingMessages: [],
    },
    contextWindow: 0,
    turnAssistantContent: '',
    reasoning: '',
    providerReplay: undefined,
    completion: undefined,
    memoryPolicyBinding: MEMORY_POLICY_BINDING_SENTINEL,
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

  it('delivers tool-terminal attribution from the exact initiating model turn', async () => {
    const params = createParams({
      memoryRetrievalEventId: 'retrieval_event_original_1',
    });
    mockedExecuteAgentControlGraphToolTurn.mockImplementationOnce(async (input) => {
      await input.finishWithGraphTerminalEvent({
        graphEvent: { type: 'BLOCKED', reason: 'test_blocked' },
        content: 'تعذر الإكمال',
        assistantMetadata: buildAssistantMessageMetadata('final', {
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        }),
        sessionEndReason: 'test_blocked',
      });
      return {
        status: 'finalized',
        lastPendingAsyncSignature: '',
        warningInjectedThisRound: false,
        workingMessages: [],
      };
    });

    await executePreparedAgentControlGraphPendingToolTurn(params);

    expect(params.iterationParams.graph.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMetadata: expect.objectContaining({
          memoryRetrievalEventId: 'retrieval_event_original_1',
        }),
        beforeAssistantDelivery: expect.any(Function),
      }),
    );
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

  it('passes the exact model-turn memory policy binding into tool execution', async () => {
    await executePreparedAgentControlGraphPendingToolTurn(createParams());

    expect(mockedExecuteAgentControlGraphToolTurn.mock.calls[0]?.[0]?.memoryPolicyBinding).toBe(
      MEMORY_POLICY_BINDING_SENTINEL,
    );
  });

  it('passes only the code-owned current user message into tool execution', async () => {
    const currentUserMessage = { id: 'user-current', text: 'Raw current request.' };
    await executePreparedAgentControlGraphPendingToolTurn(
      createParams({
        iterationParams: {
          ...createParams().iterationParams,
          toolRuntime: {
            ...createParams().iterationParams.toolRuntime,
            currentUserMessage,
          },
        },
      }),
    );

    expect(mockedExecuteAgentControlGraphToolTurn.mock.calls[0]?.[0]?.currentUserMessage).toBe(
      currentUserMessage,
    );
  });
});
