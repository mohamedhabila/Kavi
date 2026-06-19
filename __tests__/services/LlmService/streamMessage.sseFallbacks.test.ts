// ---------------------------------------------------------------------------
// Tests - LLM Service: streamMessage SSE fallbacks
// ---------------------------------------------------------------------------

import {
  createMockStreamResponse,
  LlmService,
  makeConfig,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('streamMessage SSE fallbacks', () => {
    it('should parse SSE text when response.body is unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () =>
          Promise.resolve(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
              'data: [DONE]\n\n',
          ),
      });

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual([
        'Hello',
        ' world',
      ]);
      expect(events.find((e) => e.type === 'done')?.content).toBe('Hello world');
    });

    it('should combine multi-line SSE data blocks', async () => {
      const response = createMockStreamResponse([
        'event: message\n',
        'data: {\n',
        'data:   "choices":[{"delta":{"content":"Hello world"}}]\n',
        'data: }\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual([
        'Hello world',
      ]);
      expect(events.find((e) => e.type === 'done')?.content).toBe('Hello world');
    });

    it('should keep Anthropic stream responses on the SSE path when body is unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () =>
          Promise.resolve(
            'event: message_start\n' +
              'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n' +
              'event: message_delta\n' +
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n' +
              'event: message_stop\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
      });

      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual([
        'Hello',
        ' world',
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({
          content: 'Hello world',
          providerReplay: {
            anthropicBlocks: [{ type: 'text', text: 'Hello world' }],
          },
        }),
      );
      expect(events.find((e) => e.type === 'usage')?.usage).toEqual({
        inputTokens: 12,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 13,
      });
    });

    it('falls back to buffered Anthropic SSE parsing when response.body lacks getReader', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {},
        text: () =>
          Promise.resolve(
            'event: message_start\n' +
              'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n' +
              'event: message_delta\n' +
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n' +
              'event: message_stop\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
      });

      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(
        events.filter((event) => event.type === 'token').map((event) => event.content),
      ).toEqual(['Hello', ' world']);
      expect(events.find((event) => event.type === 'done')?.content).toBe('Hello world');
      expect(events.find((event) => event.type === 'usage')?.usage).toEqual({
        inputTokens: 12,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 13,
      });
    });

    it('accumulates Anthropic text emitted entirely on content_block_start', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () =>
          Promise.resolve(
            'event: message_start\n' +
              'data: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Final worker summary"}}\n\n' +
              'event: content_block_stop\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'event: message_delta\n' +
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n' +
              'event: message_stop\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
      });

      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(
        events.filter((event) => event.type === 'token').map((event) => event.content),
      ).toEqual(['Final worker summary']);
      expect(events.find((event) => event.type === 'done')?.content).toBe('Final worker summary');
    });
  });
});
