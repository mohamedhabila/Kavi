// ---------------------------------------------------------------------------
// Tests - LLM Service: streamMessage Gemini streams
// ---------------------------------------------------------------------------

import {
  createMockStreamResponse,
  LlmService,
  makeConfig,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('streamMessage Gemini streams', () => {
    it('preserves Gemini tool-call metadata from streaming chunks', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"tc1","name":"read_file","args":{"path":"test.txt"}},"thoughtSignature":"sig-A"}]}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read file' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall.raw).toEqual({
        id: 'tc1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"test.txt"}',
        },
        thoughtSignature: 'sig-A',
        extra_content: { google: { thought_signature: 'sig-A' } },
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: '',
          providerReplay: {
            geminiParts: [
              {
                functionCall: {
                  id: 'tc1',
                  name: 'read_file',
                  args: { path: 'test.txt' },
                },
                thoughtSignature: 'sig-A',
              },
            ],
          },
        }),
      );
    });

    it('captures Gemini-compatible thought replay parts before tool calls', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"Planning tool use","thoughtSignature":"sig-thought-2"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-test',
          model: 'google/gemini-3.5-flash',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read a.txt' }], {
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      } as any)) {
        events.push(event);
      }

      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          providerReplay: {
            geminiParts: [
              {
                text: 'Planning tool use',
                thought: true,
                thoughtSignature: 'sig-thought-2',
              },
              {
                functionCall: {
                  id: 'tc1',
                  name: 'read_file',
                  args: { path: 'a.txt' },
                },
                thoughtSignature: 'sig-thought-2',
              },
            ],
          },
        }),
      );
    });

    it('emits only the final Gemini native functionCall snapshot when the tool choice is revised mid-stream', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"tc1","name":"read_file","args":{"path":"draft.txt"}}}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"tc1","name":"text_search","args":{"query":"draft"}}}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"tc1","name":"read_file","args":{"path":"final.txt"}}}]},"finishReason":"STOP"}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([
        { role: 'user', content: 'Read the final file' },
      ])) {
        events.push(event);
      }

      const toolCalls = events.filter((event) => event.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall).toMatchObject({
        id: 'tc1',
        name: 'read_file',
        arguments: '{"path":"final.txt"}',
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          providerReplay: {
            geminiParts: [
              {
                functionCall: {
                  id: 'tc1',
                  name: 'read_file',
                  args: { path: 'final.txt' },
                },
              },
            ],
          },
          completion: {
            completionStatus: 'complete',
            finishReason: 'STOP',
          },
        }),
      );
    });

    it('should handle usage data', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":8}}}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        events.push(event);
      }

      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage.usage.inputTokens).toBe(10);
      expect(usage.usage.outputTokens).toBe(5);
      expect(usage.usage.cacheReadTokens).toBe(8);
    });

    it('requests usage for Gemini-compatible streaming chat completions', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-test',
          model: 'google/gemini-2.5-pro',
        }),
      );

      for await (const _event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        // exhaust stream
      }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('surfaces usage from usage-only Gemini-compatible terminal chunks', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":18,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":12}}}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-test',
          model: 'google/gemini-2.5-pro',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        events.push(event);
      }

      expect(
        events.filter((event) => event.type === 'token').map((event) => event.content),
      ).toEqual(['Hi']);
      expect(events.find((event) => event.type === 'usage')).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 18,
          outputTokens: 4,
          cacheReadTokens: 12,
          cacheWriteTokens: 0,
          totalTokens: 22,
        },
      });
      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Hi' }),
      );
    });

    it('should normalize cached tokens from input_tokens_details in OpenAI-compatible streams', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"input_tokens_details":{"cached_tokens":6}}}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        events.push(event);
      }

      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage.usage.cacheReadTokens).toBe(6);
    });

    it('should normalize cached tokens from cache_read_input_tokens in OpenAI-compatible streams', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"cache_read_input_tokens":4}}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        events.push(event);
      }

      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage.usage.cacheReadTokens).toBe(4);
    });

    it('should handle missing [DONE] marker gracefully', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      const done = events.find((e) => e.type === 'done');
      expect(done).toBeDefined();
      expect(done.content).toBe('Hello');
      expect(done.completion).toEqual({
        completionStatus: 'incomplete',
        finishReason: 'stream_ended_without_done_marker',
      });
    });
  });
});
