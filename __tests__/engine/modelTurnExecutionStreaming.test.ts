jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  executeAgentControlGraphModelTurnStreaming,
  executeAgentControlGraphModelTurnViaSendMessage,
  MODEL_TURN_INACTIVITY_TIMEOUT_MS,
} from '../../src/engine/graph/modelTurnExecutionStreaming';
import { hasGeminiToolTurnThoughtSignatureCoverage } from '../../src/services/llm/providers/gemini/thoughtSignatureCoverage';
import {
  buildModelTurnMemoryPolicyBinding,
  POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
} from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

beforeEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  jest.useRealTimers();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

async function* unsignedToolTurnStream() {
  yield {
    type: 'tool_call' as const,
    toolCall: {
      id: 'tc1',
      name: 'read_file',
      arguments: '{"path":"test.txt"}',
      raw: {
        id: 'tc1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"test.txt"}',
        },
      },
    },
  };
  yield { type: 'done' as const, content: '' };
}

async function* duplicateSyntheticToolIdStream() {
  yield {
    type: 'tool_call' as const,
    toolCall: {
      id: 'gemini-call-0',
      name: 'tool_catalog',
      arguments: '{"query":"agent"}',
      raw: {
        id: 'gemini-call-0',
        type: 'function',
        function: {
          name: 'tool_catalog',
          arguments: '{"query":"agent"}',
        },
      },
    },
  };
  yield {
    type: 'tool_call' as const,
    toolCall: {
      id: 'gemini-call-0',
      name: 'agents',
      arguments: '{"action":"list"}',
      raw: {
        id: 'gemini-call-0',
        type: 'function',
        function: {
          name: 'agents',
          arguments: '{"action":"list"}',
        },
      },
    },
  };
  yield { type: 'done' as const, content: '' };
}

describe('executeAgentControlGraphModelTurnStreaming', () => {
  it('cancels a stalled provider iterator even when the iterator ignores the request signal', async () => {
    const abortController = new AbortController();
    const iterator = {
      next: jest.fn(() => new Promise<IteratorResult<unknown>>(() => undefined)),
      return: jest.fn(() => Promise.resolve({ done: true, value: undefined })),
    };
    const stream = {
      [Symbol.asyncIterator]: () => iterator,
    };

    const execution = executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
      iteration: 1,
      llm: { streamMessage: jest.fn(() => stream) },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gpt-5-mini',
      signal: abortController,
      streamOptions: {},
    });

    await Promise.resolve();
    abortController.abort();

    await expect(execution).rejects.toThrow('Request cancelled');
    expect(iterator.return).toHaveBeenCalledTimes(1);
  });

  it('terminates a stream after a full provider-inactivity window', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const iterator = {
      next: jest.fn(() => new Promise<IteratorResult<unknown>>(() => undefined)),
      return: jest.fn(() => Promise.resolve({ done: true, value: undefined })),
    };
    const stream = {
      [Symbol.asyncIterator]: () => iterator,
    };
    const execution = executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
      iteration: 1,
      llm: {
        streamMessage: jest.fn((_messages: unknown, options: { signal?: AbortSignal }) => {
          requestSignal = options.signal;
          return stream;
        }),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gpt-5-mini',
      signal: undefined,
      streamOptions: {},
    });

    await Promise.resolve();
    jest.advanceTimersByTime(MODEL_TURN_INACTIVITY_TIMEOUT_MS);

    await expect(execution).rejects.toThrow('without provider activity');
    expect(requestSignal?.aborted).toBe(true);
    expect(iterator.return).toHaveBeenCalledTimes(1);
  });

  it('extends the inactivity window whenever the provider emits real stream activity', async () => {
    jest.useFakeTimers();
    const abortController = new AbortController();
    let resolveNext: ((value: IteratorResult<any>) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const iterator = {
      next: jest.fn(
        () =>
          new Promise<IteratorResult<any>>((resolve) => {
            resolveNext = resolve;
          }),
      ),
      return: jest.fn(() => Promise.resolve({ done: true, value: undefined })),
    };
    const stream = {
      [Symbol.asyncIterator]: () => iterator,
    };
    const execution = executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
      iteration: 1,
      llm: {
        streamMessage: jest.fn((_messages: unknown, options: { signal?: AbortSignal }) => {
          requestSignal = options.signal;
          return stream;
        }),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gpt-5-mini',
      signal: abortController,
      streamOptions: {},
    });

    let completed = false;
    try {
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(MODEL_TURN_INACTIVITY_TIMEOUT_MS - 60_000);
      resolveNext?.({ done: false, value: { type: 'token', content: 'still working' } });
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
      expect(iterator.next).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(MODEL_TURN_INACTIVITY_TIMEOUT_MS - 60_000);
      expect(requestSignal?.aborted).toBe(false);
      resolveNext?.({ done: true, value: undefined });

      await expect(execution).resolves.toEqual(
        expect.objectContaining({ fullContent: 'still working' }),
      );
      completed = true;
    } finally {
      if (!completed) {
        abortController.abort();
        await execution.catch(() => undefined);
      }
    }
  });

  it('forwards the streaming dispatch guard to the provider boundary exactly once', async () => {
    let transportStarted = false;
    const streamMessage = jest.fn(
      (_messages: unknown, options: { requestDispatchGuard?: () => void }) =>
        (async function* () {
          options.requestDispatchGuard?.();
          transportStarted = true;
        })(),
    );
    const requestDispatchGuard = jest.fn(() => {
      throw new Error('dispatch fenced');
    });

    await expect(
      executeAgentControlGraphModelTurnStreaming({
        allowQueuedToolCalls: true,
        applyGraphEvents: jest.fn(),
        budgetTools: [],
        callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
        iteration: 1,
        llm: { streamMessage },
        memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        recordPerformanceMetrics: jest.fn(),
        reportUsage: jest.fn(),
        requestMessages: [{ role: 'user', content: 'Continue' }],
        requestModel: 'gpt-5-mini',
        signal: undefined,
        streamOptions: {
          requestDispatchGuard,
        },
      }),
    ).rejects.toThrow('dispatch fenced');
    expect(streamMessage).toHaveBeenCalledTimes(1);
    expect(requestDispatchGuard).toHaveBeenCalledTimes(1);
    expect(transportStarted).toBe(false);
  });

  it('reports terminal streaming usage once after memory authority expires', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let releaseTerminalUsage!: () => void;
    let markTokenPublished!: () => void;
    const tokenPublished = new Promise<void>((resolve) => {
      markTokenPublished = resolve;
    });
    const terminalUsageReleased = new Promise<void>((resolve) => {
      releaseTerminalUsage = resolve;
    });
    const onToken = jest.fn(() => markTokenPublished());
    const reportUsage = jest.fn();
    const streamMessage = jest.fn(() =>
      (async function* () {
        yield { type: 'token' as const, content: 'PROVISIONAL_MEMORY_OUTPUT' };
        await terminalUsageReleased;
        yield {
          type: 'usage' as const,
          usage: {
            inputTokens: 140,
            outputTokens: 12,
            cacheReadTokens: 40,
            cacheWriteTokens: 0,
            totalTokens: 152,
          },
        };
      })(),
    );

    const execution = executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: { onStateChange: jest.fn(), onToken },
      iteration: 1,
      llm: { streamMessage },
      memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
      recordPerformanceMetrics: jest.fn(),
      reportUsage,
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gpt-5-mini',
      signal: undefined,
      streamOptions: {},
    });

    await tokenPublished;
    expect(onToken).toHaveBeenCalledWith('PROVISIONAL_MEMORY_OUTPUT');
    useSettingsStore.setState({ disableLongTermMemory: true });
    releaseTerminalUsage();

    await expect(execution).rejects.toThrow('memory_prompt_epoch_expired');
    expect(reportUsage).toHaveBeenCalledTimes(1);
    expect(reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 140,
        outputTokens: 12,
        cacheReadTokens: 40,
        cacheWriteTokens: 0,
        totalTokens: 152,
      }),
    );
  });

  it('queues unsigned Gemini tool calls when allowQueuedToolCalls is true', async () => {
    const onToolCallQueued = jest.fn();

    const result = await executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [{ name: 'read_file', description: 'read', parameters: {} }],
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onToolCallQueued,
      },
      iteration: 1,
      llm: {
        streamMessage: () => unsignedToolTurnStream(),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Read file' }],
      requestModel: 'gemini-3-flash-preview',
      signal: undefined,
      streamOptions: { model: 'gemini-3-flash-preview', maxTokens: 256 },
    });

    expect(result.pendingToolCalls).toHaveLength(1);
    expect(result.pendingToolCalls[0]?.name).toBe('read_file');
    expect(onToolCallQueued).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct Gemini synthetic-id tool calls internally unique', async () => {
    const onToolCallQueued = jest.fn();

    const result = await executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [
        { name: 'tool_catalog', description: 'catalog', parameters: {} },
        { name: 'agents', description: 'agents', parameters: {} },
      ],
      callbacks: {
        onStateChange: jest.fn(),
        onToken: jest.fn(),
        onToolCallQueued,
      },
      iteration: 1,
      llm: {
        streamMessage: () => duplicateSyntheticToolIdStream(),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Find agent tools' }],
      requestModel: 'gemini-3.5-flash',
      signal: undefined,
      streamOptions: { model: 'gemini-3.5-flash', maxTokens: 256 },
    });

    expect(result.pendingToolCalls.map((call) => call.id)).toEqual([
      'gemini-call-0',
      'gemini-call-0-1',
    ]);
    expect(result.pendingToolCalls.map((call) => call.name)).toEqual(['tool_catalog', 'agents']);
    expect(onToolCallQueued).toHaveBeenCalledTimes(2);
    expect(onToolCallQueued.mock.calls.map(([call]) => call.id)).toEqual([
      'gemini-call-0',
      'gemini-call-0-1',
    ]);
  });
});

describe('executeAgentControlGraphModelTurnViaSendMessage', () => {
  it('terminates a non-streaming request after a full provider-inactivity window', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const execution = executeAgentControlGraphModelTurnViaSendMessage({
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
      geminiNative: true,
      iteration: 1,
      llm: {
        sendMessage: jest.fn((_messages: unknown, options: { signal?: AbortSignal }) => {
          requestSignal = options.signal;
          return new Promise<never>(() => undefined);
        }),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gemini-3-flash-preview',
      signal: undefined,
      streamOptions: {},
    });

    await Promise.resolve();
    jest.advanceTimersByTime(MODEL_TURN_INACTIVITY_TIMEOUT_MS);

    await expect(execution).rejects.toThrow('without provider activity');
    expect(requestSignal?.aborted).toBe(true);
  });

  it('forwards the non-streaming dispatch guard to the provider boundary exactly once', async () => {
    let transportStarted = false;
    const sendMessage = jest.fn(
      (_messages: unknown, options: { requestDispatchGuard?: () => void }) => {
        options.requestDispatchGuard?.();
        transportStarted = true;
        return Promise.resolve({ choices: [] });
      },
    );
    const requestDispatchGuard = jest.fn(() => {
      throw new Error('dispatch fenced');
    });

    await expect(
      executeAgentControlGraphModelTurnViaSendMessage({
        applyGraphEvents: jest.fn(),
        budgetTools: [],
        callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
        geminiNative: true,
        iteration: 1,
        llm: { sendMessage },
        memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        recordPerformanceMetrics: jest.fn(),
        reportUsage: jest.fn(),
        requestMessages: [{ role: 'user', content: 'Continue' }],
        requestModel: 'gemini-3-flash-preview',
        signal: undefined,
        streamOptions: {
          requestDispatchGuard,
        },
      }),
    ).rejects.toThrow('dispatch fenced');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(requestDispatchGuard).toHaveBeenCalledTimes(1);
    expect(transportStarted).toBe(false);
  });

  it('reports non-streaming usage once while rejecting content after memory authority expires', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let resolveResponse!: (response: unknown) => void;
    const response = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    const sendMessage = jest.fn(() => response);
    const callbacks = {
      onStateChange: jest.fn(),
      onToken: jest.fn(),
      onToolCallQueued: jest.fn(),
    };
    const reportUsage = jest.fn();
    const execution = executeAgentControlGraphModelTurnViaSendMessage({
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks,
      geminiNative: true,
      iteration: 1,
      llm: { sendMessage },
      memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
      recordPerformanceMetrics: jest.fn(),
      reportUsage,
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gemini-3-flash-preview',
      signal: undefined,
      streamOptions: {},
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    useSettingsStore.setState({ disableLongTermMemory: true });
    resolveResponse({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'STALE_NON_STREAMING',
            tool_calls: [
              {
                id: 'stale-call',
                function: { name: 'write_file', arguments: '{}' },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
        total_tokens: 150,
      },
    });

    await expect(execution).rejects.toThrow('memory_prompt_epoch_expired');
    expect(reportUsage).toHaveBeenCalledTimes(1);
    expect(reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-flash-preview',
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
        totalTokens: 150,
      }),
    );
    expect(callbacks.onToken).not.toHaveBeenCalled();
    expect(callbacks.onToolCallQueued).not.toHaveBeenCalled();
  });

  it('stops publishing a non-streaming response when a callback revokes memory authority', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const onToolCallQueued = jest.fn();
    const onToken = jest.fn(() => {
      useSettingsStore.setState({ disableLongTermMemory: true });
    });

    await expect(
      executeAgentControlGraphModelTurnViaSendMessage({
        applyGraphEvents: jest.fn(),
        budgetTools: [{ name: '記録_موعد', description: 'typed fixture', parameters: {} }],
        callbacks: {
          onStateChange: jest.fn(),
          onToken,
          onToolCallQueued,
        },
        geminiNative: true,
        iteration: 1,
        llm: {
          sendMessage: jest.fn().mockResolvedValue({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: 'VISIBLE_BEFORE_REVOCATION',
                  tool_calls: [
                    {
                      id: 'must-not-publish',
                      function: { name: '記録_موعد', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          }),
        },
        memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
        recordPerformanceMetrics: jest.fn(),
        reportUsage: jest.fn(),
        requestMessages: [{ role: 'user', content: 'Continue' }],
        requestModel: 'gemini-3-flash-preview',
        signal: undefined,
        streamOptions: {},
      }),
    ).rejects.toThrow('memory_prompt_epoch_expired');

    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToolCallQueued).not.toHaveBeenCalled();
  });
});

describe('executeAgentControlGraphModelTurnViaSendMessage', () => {
  it('maps generateContent tool calls with thought signatures for replay coverage', async () => {
    const callbacks = {
      onStateChange: jest.fn(),
      onToken: jest.fn(),
      onToolCallQueued: jest.fn(),
    };

    const result = await executeAgentControlGraphModelTurnViaSendMessage({
      applyGraphEvents: jest.fn(),
      budgetTools: [{ name: 'memory_recall', description: 'recall', parameters: {} }],
      callbacks,
      geminiNative: true,
      iteration: 2,
      llm: {
        sendMessage: jest.fn().mockResolvedValue({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                providerReplay: {
                  geminiParts: [
                    {
                      functionCall: {
                        name: 'memory_recall',
                        args: { subject: 'e2e-state-a' },
                      },
                      thoughtSignature: 'sig-non-stream',
                    },
                  ],
                },
                tool_calls: [
                  {
                    id: 'tc-1',
                    type: 'function',
                    function: {
                      name: 'memory_recall',
                      arguments: '{"subject":"e2e-state-a"}',
                    },
                    raw: {
                      id: 'tc-1',
                      type: 'function',
                      function: {
                        name: 'memory_recall',
                        arguments: '{"subject":"e2e-state-a"}',
                      },
                      thoughtSignature: 'sig-non-stream',
                      extra_content: { google: { thought_signature: 'sig-non-stream' } },
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'recall' }],
      requestModel: 'gemini-3.5-flash',
      signal: undefined,
      streamOptions: { model: 'gemini-3.5-flash', maxTokens: 256 },
    });

    expect(result.pendingToolCalls).toHaveLength(1);
    expect(result.pendingToolCalls[0]?.name).toBe('memory_recall');
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: result.pendingToolCalls,
        providerReplay: result.providerReplay,
      }),
    ).toBe(true);
    expect(callbacks.onToolCallQueued).toHaveBeenCalledTimes(1);
  });
});
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
