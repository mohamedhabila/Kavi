import type { PreparedAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
import { executeAgentControlGraphModelTurn } from '../../src/engine/graph/modelTurnExecution';
import { prepareAgentTurnRequestBudget } from '../../src/engine/graph/agentTurnRequestBudget';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';

jest.mock('../../src/engine/graph/agentTurnRequestBudget', () => {
  const actual = jest.requireActual('../../src/engine/graph/agentTurnRequestBudget');
  return {
    ...actual,
    prepareAgentTurnRequestBudget: jest.fn(),
  };
});

const mockedPrepareAgentTurnRequestBudget = jest.mocked(prepareAgentTurnRequestBudget);

async function* createStream(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

const toolDefinition: ToolDefinition = {
  name: 'write_file',
  description: 'Write a file to the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
    },
  },
} as ToolDefinition;

const coordinateToolDefinition: ToolDefinition = {
  name: 'update_goals',
  description: 'Mutate graph goals.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  contract: {
    category: 'tools',
    capabilities: ['coordinate'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: [],
  },
} as ToolDefinition;

function createPreparedTurn(overrides: Partial<PreparedAgentTurn> = {}): PreparedAgentTurn {
  return {
    enrichedSystemPrompt: 'Enriched prompt',
    enrichedSystemPromptSections: [],
    pinnedToolNames: [],
    selectedToolTokenEstimate: 0,
    selectedTools: [toolDefinition],
    toolsForIteration: [toolDefinition],
    ...overrides,
  };
}

function createWorkingMessages(): Message[] {
  return [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Create a file',
      timestamp: 1,
    },
  ];
}

function createBudgetResult(workingMessages: Message[], tool: ToolDefinition = toolDefinition) {
  return {
    budgetResult: {
      systemPrompt: 'Enriched prompt',
      messages: workingMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      tools: [tool],
      result: {
        totalTokens: 128,
        adjustments: [],
      },
    },
    contextWindow: 200000,
    workingMessages,
  };
}

function createCallbacks() {
  return {
    onAssistantStreamReset: jest.fn(),
    onReasoning: jest.fn(),
    onStateChange: jest.fn(),
    onToken: jest.fn(),
    onToolCallQueued: jest.fn(),
  };
}

describe('agent control graph model turn execution', () => {
  beforeEach(() => {
    mockedPrepareAgentTurnRequestBudget.mockReset();
  });

  it('retries incomplete tool-call emission after MAX_TOKENS and preserves the final call', async () => {
    const workingMessages = createWorkingMessages();
    mockedPrepareAgentTurnRequestBudget.mockResolvedValue(
      createBudgetResult(workingMessages) as any,
    );
    const llm = {
      streamMessage: jest
        .fn()
        .mockImplementationOnce(() =>
          createStream([
            {
              type: 'tool_call',
              toolCall: { id: 'tc-1', name: 'write_file', arguments: '{"path":"draft.txt"}' },
            },
            {
              type: 'done',
              completion: {
                completionStatus: 'incomplete',
                finishReason: 'max_tokens',
              },
            },
          ]),
        )
        .mockImplementationOnce(() =>
          createStream([
            {
              type: 'tool_call',
              toolCall: { id: 'tc-2', name: 'write_file', arguments: '{"path":"final.txt"}' },
            },
            {
              type: 'done',
              completion: {
                completionStatus: 'complete',
                finishReason: 'tool_calls',
              },
            },
          ]),
        ),
    };
    const callbacks = createCallbacks();
    const applyGraphEvents = jest.fn();

    const result = await executeAgentControlGraphModelTurn({
      activeProvider: {
        id: 'provider-1',
        name: 'OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
      } as any,
      applyGraphEvents,
      callbacks,
      compactionEngine: null,
      conversationId: 'conv-1',
      hasPendingAsyncOperations: false,
      iteration: 4,
      llm,
      preparedTurn: createPreparedTurn(),
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMaxTokens: 512,
      requestModel: 'gpt-5-mini',
      thinkingLevel: 'off',
      warn: jest.fn(),
      workingMessages,
      yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    });

    expect(llm.streamMessage).toHaveBeenCalledTimes(2);
    expect(llm.streamMessage.mock.calls[1]?.[1]?.maxTokens).toBeGreaterThan(
      llm.streamMessage.mock.calls[0]?.[1]?.maxTokens,
    );
    expect(callbacks.onAssistantStreamReset).toHaveBeenCalledTimes(1);
    expect(callbacks.onStateChange).toHaveBeenCalledWith('thinking');
    expect(applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'MODEL_TURN_FAILED',
        iteration: 4,
        reason: 'incomplete_tool_call_emission_retry',
      },
    ]);
    expect(result.pendingToolCalls).toEqual([
      {
        id: 'tc-2',
        name: 'write_file',
        arguments: '{"path":"final.txt"}',
      },
    ]);
  });

  it('does not add an exact tool-choice gate for a graph-batched turn', async () => {
    const workingMessages = createWorkingMessages();
    mockedPrepareAgentTurnRequestBudget.mockResolvedValue(
      createBudgetResult(workingMessages) as any,
    );
    const llm = {
      streamMessage: jest.fn().mockImplementation(() =>
        createStream([
          {
            type: 'tool_call',
            toolCall: { id: 'tc-1', name: 'write_file', arguments: '{"path":"a.txt"}' },
          },
          {
            type: 'tool_call',
            toolCall: { id: 'tc-2', name: 'write_file', arguments: '{"path":"b.txt"}' },
          },
          {
            type: 'done',
            completion: {
              completionStatus: 'complete',
              finishReason: 'tool_calls',
            },
          },
        ]),
      ),
    };

    await executeAgentControlGraphModelTurn({
      activeProvider: {
        id: 'provider-1',
        name: 'OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
      } as any,
      applyGraphEvents: jest.fn(),
      callbacks: createCallbacks(),
      compactionEngine: null,
      conversationId: 'conv-1',
      hasPendingAsyncOperations: false,
      iteration: 2,
      llm,
      preparedTurn: createPreparedTurn(),
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMaxTokens: 512,
      requestModel: 'gpt-5-mini',
      thinkingLevel: 'off',
      warn: jest.fn(),
      workingMessages,
      yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    });

    expect(llm.streamMessage.mock.calls[0]?.[1]?.toolChoice).toBeUndefined();
  });

  it('does not force exact tool choice from singleton pinned telemetry', async () => {
    const workingMessages = createWorkingMessages();
    mockedPrepareAgentTurnRequestBudget.mockResolvedValue(
      createBudgetResult(workingMessages) as any,
    );
    const llm = {
      streamMessage: jest.fn().mockImplementation(() =>
        createStream([
          {
            type: 'tool_call',
            toolCall: { id: 'tc-1', name: 'write_file', arguments: '{"path":"a.txt"}' },
          },
          {
            type: 'done',
            completion: {
              completionStatus: 'complete',
              finishReason: 'tool_calls',
            },
          },
        ]),
      ),
    };

    await executeAgentControlGraphModelTurn({
      activeProvider: {
        id: 'provider-1',
        name: 'OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
      } as any,
      applyGraphEvents: jest.fn(),
      callbacks: createCallbacks(),
      compactionEngine: null,
      conversationId: 'conv-1',
      hasPendingAsyncOperations: false,
      iteration: 2,
      llm,
      preparedTurn: createPreparedTurn({ pinnedToolNames: ['write_file'] }),
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMaxTokens: 512,
      requestModel: 'gpt-5-mini',
      thinkingLevel: 'off',
      warn: jest.fn(),
      workingMessages,
      yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    });

    expect(llm.streamMessage.mock.calls[0]?.[1]?.toolChoice).toBeUndefined();
  });

  it('requires tool use while pending async operations need monitoring', async () => {
    const workingMessages = createWorkingMessages();
    mockedPrepareAgentTurnRequestBudget.mockResolvedValue(
      createBudgetResult(workingMessages, coordinateToolDefinition) as any,
    );
    const llm = {
      streamMessage: jest.fn().mockImplementation(() =>
        createStream([
          { type: 'token', content: 'Done.' },
          {
            type: 'done',
            completion: {
              completionStatus: 'complete',
              finishReason: 'stop',
            },
          },
        ]),
      ),
    };

    await executeAgentControlGraphModelTurn({
      activeProvider: {
        id: 'provider-1',
        name: 'OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
      } as any,
      applyGraphEvents: jest.fn(),
      callbacks: createCallbacks(),
      compactionEngine: null,
      conversationId: 'conv-1',
      hasPendingAsyncOperations: true,
      iteration: 2,
      llm,
      preparedTurn: createPreparedTurn({
        pinnedToolNames: ['update_goals'],
        selectedTools: [coordinateToolDefinition],
        toolsForIteration: [coordinateToolDefinition],
      }),
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMaxTokens: 512,
      requestModel: 'gpt-5-mini',
      thinkingLevel: 'off',
      warn: jest.fn(),
      workingMessages,
      yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    });

    expect(llm.streamMessage.mock.calls[0]?.[1]?.toolChoice).toBe('required');
  });

  it('retries provider overflow after compaction and lowers the retry budget', async () => {
    const workingMessages = createWorkingMessages();
    mockedPrepareAgentTurnRequestBudget.mockResolvedValue(
      createBudgetResult(workingMessages) as any,
    );
    const llm = {
      streamMessage: jest
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('context window exceeded');
        })
        .mockImplementationOnce(() =>
          createStream([
            { type: 'token', content: 'done' },
            {
              type: 'done',
              completion: {
                completionStatus: 'complete',
                finishReason: 'stop',
              },
            },
          ]),
        ),
    };
    const callbacks = createCallbacks();
    const applyGraphEvents = jest.fn();
    const compactionEngine = {
      compact: jest.fn().mockResolvedValue({
        compacted: true,
        tier: 'aggressive',
        result: {
          summary: 'Context compacted aggressively',
          firstKeptEntryId: 'msg-1',
          tokensBefore: 4000,
          tokensAfter: 2000,
        },
      }),
    };

    const result = await executeAgentControlGraphModelTurn({
      activeProvider: {
        id: 'provider-1',
        name: 'OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
      } as any,
      applyGraphEvents,
      callbacks,
      compactionEngine,
      conversationId: 'conv-1',
      hasPendingAsyncOperations: false,
      iteration: 6,
      llm,
      onCompaction: jest.fn(),
      preparedTurn: createPreparedTurn(),
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMaxTokens: 8192,
      requestModel: 'gpt-5-mini',
      thinkingLevel: 'off',
      warn: jest.fn(),
      workingMessages,
      yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    });

    expect(llm.streamMessage).toHaveBeenCalledTimes(2);
    expect(llm.streamMessage.mock.calls[1]?.[1]?.maxTokens).toBeLessThan(
      llm.streamMessage.mock.calls[0]?.[1]?.maxTokens,
    );
    expect(callbacks.onAssistantStreamReset).toHaveBeenCalledTimes(1);
    expect(compactionEngine.compact).toHaveBeenCalledTimes(1);
    expect(result.fullContent).toBe('done');
    expect(applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'MODEL_TURN_FAILED',
        iteration: 6,
        reason: 'context window exceeded',
      },
    ]);
  });
});
