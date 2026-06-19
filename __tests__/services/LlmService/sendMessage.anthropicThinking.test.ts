// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic thinking options
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic thinking options', () => {
    it('forwards Anthropic adaptive thinking parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
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

      await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
    });

    it('adds Anthropic native structured output without requiring thinking', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: '{"approved":true}' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
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

      const result = await service.sendMessage(
        [{ role: 'user', content: 'Return the pilot report.' }],
        {
          structuredOutput: {
            name: 'pilot_report',
            mimeType: 'application/json',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                approved: { type: 'boolean' },
              },
              required: ['approved'],
            },
          },
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toEqual({
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['approved'],
            properties: {
              approved: { type: 'boolean' },
            },
          },
        },
      });
      expect(result?.providerResponse).toEqual({
        provider: 'anthropic',
        response: expect.objectContaining({
          content: expect.any(Array),
        }),
      });
      expect(result?.output_parsed).toEqual({ approved: true });
    });

    it('returns Anthropic summarized thinking as message reasoning in non-streaming responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [
              { type: 'thinking', thinking: 'Need a plan first.', signature: 'sig-A' },
              { type: 'text', text: 'ok' },
            ],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
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

      const result = await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        thinking: { type: 'adaptive' },
      });

      expect(result.choices[0].message.reasoning).toBe('Need a plan first.');
      expect(result.choices[0].message.providerReplay).toEqual({
        anthropicBlocks: [
          { type: 'thinking', thinking: 'Need a plan first.', signature: 'sig-A' },
          { type: 'text', text: 'ok' },
        ],
      });
    });

    it('removes Anthropic temperature when adaptive thinking is enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
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

      await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        temperature: 0.2,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'high' });
      expect(body.temperature).toBeUndefined();
    });

    it('omits non-1 direct Anthropic temperature for Claude Sonnet 4.6 requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
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

      await service.sendMessage([{ role: 'user', content: 'Return a structured review.' }], {
        temperature: 0,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBeUndefined();
    });

    it('preserves direct Anthropic temperature for Claude Haiku 4.5 requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-haiku-4-5',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Be concise.' }], {
        temperature: 0.2,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.2);
    });
  });
});
