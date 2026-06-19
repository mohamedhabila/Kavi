// ---------------------------------------------------------------------------
// Tests - LLM Service: streamMessage compatible streams
// ---------------------------------------------------------------------------

import {
  createMockStreamResponse,
  LlmService,
  makeConfig,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('streamMessage compatible streams', () => {
    it('should stream tokens from SSE response', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      const tokens = events.filter((e) => e.type === 'token');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].content).toBe('Hello');
      expect(tokens[1].content).toBe(' world');

      const done = events.find((e) => e.type === 'done');
      expect(done).toBeDefined();
      expect(done.content).toBe('Hello world');
    });

    it('should handle reasoning tokens', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      const reasoning = events.filter((e) => e.type === 'reasoning');
      expect(reasoning).toHaveLength(1);
      expect(reasoning[0].content).toBe('Let me think');
    });

    it('routes Gemini reasoning tokens to dedicated reasoning events', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Let me think","thought":true}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"Answer"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":7,"totalTokenCount":22}}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-2.5-pro',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
        expect.any(Object),
      );

      expect(events.filter((e) => e.type === 'reasoning')).toEqual([
        expect.objectContaining({ type: 'reasoning', content: 'Let me think' }),
      ]);
      expect(events.filter((e) => e.type === 'token')).toEqual([
        expect.objectContaining({ type: 'token', content: 'Answer' }),
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: 'Answer',
          providerReplay: {
            geminiParts: [{ text: 'Let me think', thought: true }, { text: 'Answer' }],
          },
        }),
      );
    });

    it('routes structured thought parts to reasoning for non-Gemini streams', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Need plan","thought":true},{"type":"text","text":"Answer"}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'reasoning')).toEqual([
        expect.objectContaining({ type: 'reasoning', content: 'Need plan' }),
      ]);
      expect(events.filter((e) => e.type === 'token')).toEqual([
        expect.objectContaining({ type: 'token', content: 'Answer' }),
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Answer' }),
      );
    });

    it('routes Gemini thought parts embedded in structured content arrays to reasoning', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Need plan","thought":true},{"text":"Answer"}]}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-3.1-pro-preview',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'reasoning')).toEqual([
        expect.objectContaining({ type: 'reasoning', content: 'Need plan' }),
      ]);
      expect(events.filter((e) => e.type === 'token')).toEqual([
        expect.objectContaining({ type: 'token', content: 'Answer' }),
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Answer' }),
      );
    });

    it('marks Gemini streams without a finish reason as incomplete completions', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Answer"}]}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-2.5-pro',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: 'Answer',
          completion: {
            completionStatus: 'incomplete',
            finishReason: 'stream_ended_without_finish_reason',
          },
        }),
      );
    });

    it('dedupes cumulative Gemini text deltas', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello world"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello world from Gemini"}]}}]}\n\n',
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

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual([
        'Hello',
        ' world',
        ' from Gemini',
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Hello world from Gemini' }),
      );
    });

    it('should handle tool call chunks', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test.txt\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read file' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall.id).toBe('tc1');
      expect(toolCalls[0].toolCall.name).toBe('read_file');
      expect(toolCalls[0].toolCall.arguments).toBe('{"path":"test.txt"}');
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
    });

    it('should merge cumulative tool call argument snapshots for compat streams', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_atars_1","function":{"name":"atars__get_multi_indicator","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"symbol\\":\\"AAPL\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"symbol\\":\\"AAPL\\",\\"indicators\\":[\\"rsi\\"]"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"symbol\\":\\"AAPL\\",\\"indicators\\":[\\"rsi\\",\\"macd\\"],\\"timeframe\\":\\"1d\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Use aTars' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall.id).toBe('tc_atars_1');
      expect(toolCalls[0].toolCall.name).toBe('atars__get_multi_indicator');
      expect(toolCalls[0].toolCall.arguments).toBe(
        '{"symbol":"AAPL","indicators":["rsi","macd"],"timeframe":"1d"}',
      );
      expect(JSON.parse(toolCalls[0].toolCall.arguments)).toEqual({
        symbol: 'AAPL',
        indicators: ['rsi', 'macd'],
        timeframe: '1d',
      });
    });
  });
});
