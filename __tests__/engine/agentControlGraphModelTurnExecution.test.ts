jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeAgentControlGraphModelTurn } from '../../src/engine/graph/modelTurnExecution';
import { prepareAgentTurnRequestBudget } from '../../src/engine/graph/agentTurnRequestBudget';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';
import {
  coordinateToolDefinition,
  createBudgetResult,
  createCallbacks,
  createPreparedTurn,
  createStream,
  createWorkingMessages,
  memoryRememberToolDefinition,
  toolDefinition,
} from './helpers/modelTurnExecution';

jest.mock('../../src/engine/graph/agentTurnRequestBudget', () => {
  const actual = jest.requireActual('../../src/engine/graph/agentTurnRequestBudget');
  return {
    ...actual,
    prepareAgentTurnRequestBudget: jest.fn(),
  };
});

const mockedPrepareAgentTurnRequestBudget = jest.mocked(prepareAgentTurnRequestBudget);

describe('agent control graph model turn execution', () => {
  beforeEach(() => {
    mockedPrepareAgentTurnRequestBudget.mockReset();
    useSettingsStore.setState({ disableLongTermMemory: false });
    initializeMemoryPolicyObservation();
  });

  afterEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  it('escalates opt-out during async budgeting to session-level repreparation', async () => {
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
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const { readEpoch } = memoryFence;
    let resolveFirstBudget!: (value: ReturnType<typeof createBudgetResult>) => void;
    const firstBudget = new Promise<ReturnType<typeof createBudgetResult>>((resolve) => {
      resolveFirstBudget = resolve;
    });
    mockedPrepareAgentTurnRequestBudget.mockImplementationOnce(() => firstBudget as never);
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
          ...memoryFence,
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

    await expect(execution).rejects.toThrow('memory_prompt_epoch_expired');
    expect(mockedPrepareAgentTurnRequestBudget).toHaveBeenCalledTimes(1);
    expect(llm.streamMessage).not.toHaveBeenCalled();
    expect(callbacks.onAssistantStreamReset).not.toHaveBeenCalled();
  });

  it('discards streamed output and un-emitted tool calls when opt-out lands mid-stream', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let releaseFirstAttempt!: () => void;
    let markFirstToken!: () => void;
    const firstToken = new Promise<void>((resolve) => {
      markFirstToken = resolve;
    });
    const firstAttemptGate = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    async function* staleAttempt() {
      yield { type: 'token', content: 'STALE_ATTEMPT' };
      await firstAttemptGate;
      yield {
        type: 'tool_call',
        toolCall: {
          id: 'stale-memory-call',
          name: memoryRememberToolDefinition.name,
          arguments: '{}',
        },
      };
      yield { type: 'done', completion: { completionStatus: 'complete', finishReason: 'stop' } };
    }
    mockedPrepareAgentTurnRequestBudget.mockImplementation(async (params) => {
      const result = createBudgetResult(params.workingMessages);
      return {
        ...result,
        budgetResult: {
          ...result.budgetResult,
          systemPrompt: params.enrichedSystemPrompt,
          tools: params.toolsForIteration ?? [],
        },
      };
    });
    const llm = {
      streamMessage: jest
        .fn()
        .mockImplementationOnce(() => staleAttempt())
        .mockImplementationOnce(() =>
          createStream([
            { type: 'token', content: 'SAFE_ATTEMPT' },
            {
              type: 'done',
              completion: { completionStatus: 'complete', finishReason: 'stop' },
            },
          ]),
        ),
    };
    const visibleEvents: string[] = [];
    const callbacks = {
      ...createCallbacks(),
      onAssistantStreamReset: jest.fn(() => visibleEvents.push('reset')),
      onToken: jest.fn((token: string) => {
        visibleEvents.push(`token:${token}`);
        markFirstToken();
      }),
    };
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
      conversationId: 'conv-memory-stream-race',
      hasPendingAsyncOperations: false,
      iteration: 1,
      livingMemory: null,
      llm,
      preparedTurn: createPreparedTurn({
        enrichedSystemPrompt: 'Memory-enabled system',
        enrichedSystemPromptSections: [{ text: 'Memory-enabled system' }],
        memoryReadFence: {
          ...memoryFence,
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
      workingMessages: createWorkingMessages(),
      yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    });

    await firstToken;
    useSettingsStore.setState({ disableLongTermMemory: true });
    releaseFirstAttempt();

    await expect(execution).rejects.toThrow('memory_prompt_epoch_expired');
    expect(visibleEvents).toEqual(['token:STALE_ATTEMPT', 'reset']);
    expect(callbacks.onToolCallQueued).not.toHaveBeenCalled();
    expect(llm.streamMessage).toHaveBeenCalledTimes(1);
  });

  it('fences replay dispatches after opt-out and escalates to the session', async () => {
    const workingMessages = createWorkingMessages();
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const { readEpoch } = memoryFence;
    mockedPrepareAgentTurnRequestBudget.mockImplementation(async (params) => ({
      ...createBudgetResult(params.workingMessages),
      budgetResult: {
        ...createBudgetResult(params.workingMessages).budgetResult,
        systemPrompt: params.enrichedSystemPrompt,
      },
    }));
    let transportStarts = 0;
    const llm = {
      streamMessage: jest.fn(
        (_messages: unknown, options: { requestDispatchGuard?: () => void }) => {
          options.requestDispatchGuard?.();
          transportStarts += 1;
          return transportStarts === 1
            ? createStream([
                {
                  type: 'tool_call',
                  toolCall: { id: 'tc-private', name: 'write_file', arguments: '{}' },
                },
                { type: 'done', completion: { completionStatus: 'complete' } },
              ])
            : createStream([
                { type: 'token', content: 'Memory-free response.' },
                {
                  type: 'done',
                  completion: { completionStatus: 'complete', finishReason: 'stop' },
                },
              ]);
        },
      ),
    };
    let yieldCount = 0;

    const execution = executeAgentControlGraphModelTurn({
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
          ...memoryFence,
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

    await expect(execution).rejects.toThrow('memory_prompt_epoch_expired');
    expect(llm.streamMessage).toHaveBeenCalledTimes(2);
    expect(transportStarts).toBe(1);
    expect(JSON.stringify(llm.streamMessage.mock.calls[0]?.[0])).toContain('PRIVATE REPLAY MEMORY');
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
