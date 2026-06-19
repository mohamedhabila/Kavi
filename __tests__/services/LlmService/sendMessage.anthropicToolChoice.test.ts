// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic tool choice
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic tool choice', () => {
    it('disables Anthropic thinking when tool use is forced', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Use the tool.' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [
          {
            name: 'read_file',
            description: 'Read a file.',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
        toolChoice: 'required',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: 'any' });
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
    });

    it('allows required Anthropic tool turns to disable parallel tool use', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Wait for the worker output.' }], {
        tools: [
          {
            name: 'sessions_wait',
            description: 'Wait for background worker output.',
            input_schema: {
              type: 'object',
              properties: { sessionId: { type: 'string' } },
              required: [],
            },
          },
        ],
        toolChoice: { type: 'required', disableParallelToolUse: true },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({
        type: 'any',
        disable_parallel_tool_use: true,
      });
    });

    it('forces one exact Anthropic tool when requested', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Return the pilot report.' }], {
        thinking: { type: 'adaptive' },
        tools: [
          {
            name: 'pilot_report',
            description: 'Return the pilot report.',
            input_schema: {
              type: 'object',
              properties: { approved: { type: 'boolean' } },
              required: ['approved'],
              additionalProperties: false,
            },
          },
        ],
        toolChoice: { type: 'tool', name: 'pilot_report', disableParallelToolUse: true },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({
        type: 'tool',
        name: 'pilot_report',
        disable_parallel_tool_use: true,
      });
      expect(body.thinking).toBeUndefined();
    });

    it('keeps Anthropic thinking enabled when tool use is optional', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Use a tool if needed.' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [
          {
            name: 'read_file',
            description: 'Read a file.',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
    });
  });
});
