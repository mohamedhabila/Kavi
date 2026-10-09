jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeAgentControlGraphModelTurnStreaming } from '../../src/engine/graph/modelTurnExecutionStreaming';
import { executeAgentControlGraphModelTurnViaSendMessage } from '../../src/engine/graph/modelTurnExecutionSendMessage';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { readUpstreamProvider } from '../../src/services/llm/core/streaming/metadataBuilder';
import { streamOpenAICompatibleChat } from '../../src/services/llm/providers/openaiChat/stream';
import { aggregateE2ETokenUsage } from '../../src/acceptance/e2eAgent/tokenUsage';

function streamOf(events: ReadonlyArray<Record<string, unknown>>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        await Promise.resolve();
        yield event;
      }
    },
  };
}

function sseResponse(chunks: ReadonlyArray<unknown>): Response {
  const body = chunks
    .map((chunk) => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`)
    .join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('readUpstreamProvider', () => {
  it.each([
    [{ provider: 'Fireworks' }, 'Fireworks'],
    [{ provider: '  Parasail ' }, 'Parasail'],
    [{ provider: '' }, undefined],
    [{ provider: 'x'.repeat(81) }, undefined],
    [{ provider: { name: 'Fireworks' } }, undefined],
    [null, undefined],
    ['Fireworks', undefined],
  ])('reads %p as %p', (response, expected) => {
    expect(readUpstreamProvider(response)).toBe(expected);
  });
});

describe('upstream provider on usage', () => {
  it('is read from an OpenRouter stream chunk alongside its usage', async () => {
    const events = [];
    for await (const event of streamOpenAICompatibleChat({
      response: sseResponse([
        { provider: 'Fireworks', choices: [{ delta: { content: 'Hi' } }] },
        {
          provider: 'Fireworks',
          choices: [],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 4,
            prompt_tokens_details: { cached_tokens: 1024 },
          },
        },
        '[DONE]',
      ]),
      geminiTarget: false,
      shouldSurfaceReasoning: false,
      extractOpenAiCompatibleStreamText: (value) => ({ content: String(value ?? '') }),
      extractOpenAiCompatibleTextValue: (value) => String(value ?? ''),
      trimGeminiCumulativeText: (_full, incoming) => incoming,
      safeJsonParse: (value) => value,
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === 'usage')).toEqual({
      type: 'usage',
      usage: expect.objectContaining({
        inputTokens: 1200,
        cacheReadTokens: 1024,
        upstreamProvider: 'Fireworks',
      }),
    });
  });

  it('reaches the reported turn usage on the streaming path', async () => {
    const reportUsage = jest.fn();

    await executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
      iteration: 1,
      llm: {
        streamMessage: jest.fn(() =>
          streamOf([
            { type: 'token', content: 'Hi' },
            {
              type: 'usage',
              usage: { inputTokens: 900, outputTokens: 3, upstreamProvider: 'Parasail' },
            },
            { type: 'done' },
          ]),
        ),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage,
      requestMessages: [{ role: 'user', content: 'Hello' }],
      requestModel: 'z-ai/glm-5.3-flash',
      signal: undefined,
      streamOptions: {},
    } as never);

    expect(reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 900, upstreamProvider: 'Parasail' }),
    );
  });

  it('counts cached tokens an OpenAI-shaped non-streaming response reports', async () => {
    // Regression: this path read only Anthropic's `cache_read_input_tokens`, so every
    // OpenAI-shaped response reported zero cache reads.
    const reportUsage = jest.fn();

    await executeAgentControlGraphModelTurnViaSendMessage({
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: { onStateChange: jest.fn(), onToken: jest.fn() },
      geminiNative: true,
      iteration: 1,
      llm: {
        sendMessage: jest.fn(async () => ({
          provider: 'Together',
          choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 3000,
            completion_tokens: 10,
            total_tokens: 3010,
            prompt_tokens_details: { cached_tokens: 2048 },
          },
        })),
      },
      memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
      recordPerformanceMetrics: jest.fn(),
      reportUsage,
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gemini-3-flash-preview',
      signal: undefined,
      streamOptions: {},
    } as never);

    expect(reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 3000,
        outputTokens: 10,
        cacheReadTokens: 2048,
        upstreamProvider: 'Together',
      }),
    );
  });
});

describe('aggregateE2ETokenUsage per-call rows', () => {
  it('keeps each call in order with its cache reads, tool surface, and upstream', () => {
    const summary = aggregateE2ETokenUsage([
      {
        model: 'm',
        inputTokens: 1000,
        outputTokens: 5,
        cacheReadTokens: 0,
        upstreamProvider: 'Fireworks',
        tokenBuckets: {
          systemPromptTokens: 100,
          toolDeclarationTokens: 600,
          memoryContextTokens: 0,
          conversationHistoryTokens: 0,
          userTurnTokens: 10,
          toolResultTokens: 0,
        },
      },
      { model: 'm', inputTokens: 1100, outputTokens: 7, cacheReadTokens: 900 },
    ]);

    expect(summary.calls).toEqual([
      {
        inputTokens: 1000,
        outputTokens: 5,
        cacheReadTokens: 0,
        toolDeclarationTokens: 600,
        upstreamProvider: 'Fireworks',
      },
      { inputTokens: 1100, outputTokens: 7, cacheReadTokens: 900 },
    ]);
  });
});
