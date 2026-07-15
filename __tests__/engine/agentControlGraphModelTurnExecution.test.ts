import type { PreparedAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
import { executeAgentControlGraphModelTurn } from '../../src/engine/graph/modelTurnExecution';
import { prepareAgentTurnRequestBudget } from '../../src/engine/graph/agentTurnRequestBudget';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import {
  captureMemoryReadEpoch,
  initializeMemoryPolicyObservation,
} from '../../src/services/memory/policy';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { MEMORY_DISABLED_RUNTIME_CAPABILITY } from '../../src/engine/prompts/memoryPolicyPrompt';

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

const memoryRememberToolDefinition: ToolDefinition = {
  name: 'memory_remember',
  description: 'Record a durable memory.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'memory',
    capabilities: ['write'],
    resourceKinds: ['memory'],
    sideEffects: ['local_artifact'],
  },
};

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
    useSettingsStore.setState({ disableLongTermMemory: false });
    initializeMemoryPolicyObservation();
  });

  afterEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  it('reprepares a memory-free request when opt-out lands during async request budgeting', async () => {
    const safeWorkingMessages = createWorkingMessages();
    const workingMessages: Message[] = [
      {
        id: 'compact_prior-memory',
        role: 'system',
        content: 'Summary containing PRIVATE LIVING MEMORY',
        timestamp: 0,
      },
      ...safeWorkingMessages,
    ];
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory epoch');
    let resolveFirstBudget!: (value: ReturnType<typeof createBudgetResult>) => void;
    const firstBudget = new Promise<ReturnType<typeof createBudgetResult>>((resolve) => {
      resolveFirstBudget = resolve;
    });
    mockedPrepareAgentTurnRequestBudget
      .mockImplementationOnce(() => firstBudget as never)
      .mockImplementationOnce(async (params) => ({
        ...createBudgetResult(params.workingMessages),
        budgetResult: {
          ...createBudgetResult(params.workingMessages).budgetResult,
          systemPrompt: params.enrichedSystemPrompt,
        },
      }));
    const llm = {
      streamMessage: jest.fn((_messages: unknown, _options?: unknown) =>
        createStream([
          { type: 'token', content: 'Safe response.' },
          { type: 'done', completion: { completionStatus: 'complete', finishReason: 'stop' } },
        ]),
      ),
    };
    const callbacks = createCallbacks();
    const execution = executeAgentControlGraphModelTurn({
      activeProvider: {
        id: 'provider-1',
        name: 'OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
      } as any,
      applyGraphEvents: jest.fn(),
      callbacks,
      compactionEngine: null,
      conversationId: 'conv-memory-budget-race',
      hasPendingAsyncOperations: false,
      iteration: 1,
      livingMemory: {
        memoryReadEpoch: readEpoch,
        sections: [{ text: 'PRIVATE LIVING MEMORY', cacheable: true }],
      } as never,
      llm,
      preparedTurn: createPreparedTurn({
        enrichedSystemPrompt: 'System\n\nPRIVATE LIVING MEMORY',
        enrichedSystemPromptSections: [
          { text: 'System', cacheable: true },
          { text: 'PRIVATE LIVING MEMORY', cacheable: true },
        ],
        memoryReadFence: {
          readEpoch,
          memoryFreePrompt: {
            enrichedSystemPrompt: 'Memory-free system',
            enrichedSystemPromptSections: [{ text: 'Memory-free system', cacheable: true }],
          },
          memoryDisabledTurn: createPreparedTurn({
            enrichedSystemPrompt: `Memory-free system\n\n${MEMORY_DISABLED_RUNTIME_CAPABILITY}`,
            enrichedSystemPromptSections: [
              { text: 'Memory-free system', cacheable: true },
              { text: MEMORY_DISABLED_RUNTIME_CAPABILITY },
            ],
            selectedTools: [toolDefinition],
            toolsForIteration: [toolDefinition],
          }),
        },
        selectedTools: [toolDefinition, memoryRememberToolDefinition],
        toolsForIteration: [toolDefinition, memoryRememberToolDefinition],
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

    expect(mockedPrepareAgentTurnRequestBudget).toHaveBeenCalledTimes(1);
    useSettingsStore.setState({ disableLongTermMemory: true });
    resolveFirstBudget({
      ...createBudgetResult([
        {
          id: 'compact-private',
          role: 'system',
          content: 'Summary containing PRIVATE LIVING MEMORY',
          timestamp: 1,
        },
        ...workingMessages,
      ]),
      budgetResult: {
        ...createBudgetResult(workingMessages).budgetResult,
        systemPrompt: 'System\n\nPRIVATE LIVING MEMORY',
      },
    });

    await expect(execution).resolves.toMatchObject({ fullContent: 'Safe response.' });
    expect(mockedPrepareAgentTurnRequestBudget).toHaveBeenCalledTimes(2);
    expect(mockedPrepareAgentTurnRequestBudget.mock.calls[1]?.[0]).toMatchObject({
      enrichedSystemPrompt: expect.stringContaining('Memory-free system'),
      livingMemory: null,
      workingMessages: safeWorkingMessages,
    });
    expect(mockedPrepareAgentTurnRequestBudget.mock.calls[1]?.[0].enrichedSystemPrompt).toContain(
      MEMORY_DISABLED_RUNTIME_CAPABILITY,
    );
    expect(
      mockedPrepareAgentTurnRequestBudget.mock.calls[1]?.[0].toolsForIteration?.map(
        (tool) => tool.name,
      ),
    ).toEqual(['write_file']);
    expect(llm.streamMessage).toHaveBeenCalledTimes(1);
    const dispatchedOptions = llm.streamMessage.mock.calls[0]?.[1] as {
      tools: ToolDefinition[];
    };
    expect(dispatchedOptions.tools.map((tool) => tool.name)).toEqual(['write_file']);
    expect(JSON.stringify(llm.streamMessage.mock.calls[0]?.[0])).not.toContain(
      'PRIVATE LIVING MEMORY',
    );
    expect(callbacks.onAssistantStreamReset).toHaveBeenCalledTimes(1);
  });

  it('fences replay dispatches after opt-out and resumes with a memory-free turn', async () => {
    const workingMessages = createWorkingMessages();
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory epoch');
    mockedPrepareAgentTurnRequestBudget.mockImplementation(async (params) => ({
      ...createBudgetResult(params.workingMessages),
      budgetResult: {
        ...createBudgetResult(params.workingMessages).budgetResult,
        systemPrompt: params.enrichedSystemPrompt,
      },
    }));
    const llm = {
      streamMessage: jest
        .fn()
        .mockImplementationOnce(() =>
          createStream([
            {
              type: 'tool_call',
              toolCall: { id: 'tc-private', name: 'write_file', arguments: '{}' },
            },
            { type: 'done', completion: { completionStatus: 'complete' } },
          ]),
        )
        .mockImplementationOnce(() =>
          createStream([
            { type: 'token', content: 'Memory-free response.' },
            { type: 'done', completion: { completionStatus: 'complete', finishReason: 'stop' } },
          ]),
        ),
    };
    let yieldCount = 0;

    const result = await executeAgentControlGraphModelTurn({
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
      conversationId: 'conv-memory-replay-race',
      hasPendingAsyncOperations: false,
      iteration: 1,
      livingMemory: { memoryReadEpoch: readEpoch, sections: [] } as never,
      llm,
      preparedTurn: createPreparedTurn({
        enrichedSystemPrompt: 'System\n\nPRIVATE REPLAY MEMORY',
        memoryReadFence: {
          readEpoch,
          memoryFreePrompt: {
            enrichedSystemPrompt: 'Memory-free replay system',
            enrichedSystemPromptSections: [{ text: 'Memory-free replay system' }],
          },
        },
      }),
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMaxTokens: 512,
      requestModel: 'gemini-3-flash-preview',
      thinkingLevel: 'off',
      warn: jest.fn(),
      workingMessages,
      yieldToUiFrame: jest.fn(async () => {
        yieldCount += 1;
        if (yieldCount === 1) useSettingsStore.setState({ disableLongTermMemory: true });
      }),
    });

    expect(result.fullContent).toBe('Memory-free response.');
    expect(llm.streamMessage).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(llm.streamMessage.mock.calls[0]?.[0])).toContain('PRIVATE REPLAY MEMORY');
    expect(JSON.stringify(llm.streamMessage.mock.calls[1]?.[0])).not.toContain(
      'PRIVATE REPLAY MEMORY',
    );
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
