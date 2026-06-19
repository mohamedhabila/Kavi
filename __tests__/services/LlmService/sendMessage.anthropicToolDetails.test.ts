// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic tool details
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic tool details', () => {
    it('keeps Anthropic thinking enabled while continuing a tool loop with replayable redacted thinking blocks', async () => {
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

      await service.sendMessage(
        [
          { role: 'user', content: 'Run the tool.' },
          {
            role: 'assistant',
            content: '',
            providerReplay: {
              anthropicBlocks: [
                { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
                {
                  type: 'tool_use',
                  id: 'toolu_1',
                  name: 'read_file',
                  input: { path: 'notes.txt' },
                },
              ],
            },
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                raw: {
                  id: 'toolu_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                },
              },
            ],
          } as any,
          { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' } as any,
        ],
        {
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
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
    });

    it('uses the shared model output budget when Anthropic callers omit maxTokens', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Hello' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(32000);
    });

    it('clamps Anthropic thinking budgets below max_tokens for direct callers', async () => {
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
        maxTokens: 2048,
        thinking: { type: 'enabled', budget_tokens: 32768 },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(2048);
      expect(body.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 2047,
        display: 'summarized',
      });
    });

    it('preserves full Anthropic tool descriptions per best practices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 4 },
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

      const fullDescription =
        'Spawn an isolated sub-agent session to perform a task in parallel. ' +
        'By default it launches in the background so the agent can poll status and continue other work. ' +
        'Sub-agents are intentionally untimed and keep running until completion unless you cancel them for drift or redundancy. ' +
        'Use waitForCompletion=true only when you intentionally want to wait on that worker in the current tool call.';

      await service.sendMessage([{ role: 'user', content: 'Spawn a sub-agent.' }], {
        tools: [
          {
            name: 'sessions_spawn',
            description: fullDescription,
            input_schema: {
              type: 'object',
              properties: {
                prompt: { type: 'string', description: 'Task instructions for the sub-agent' },
                model: { type: 'string', description: 'Model override (optional)' },
              },
              required: ['prompt'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Full description preserved (not truncated to first sentence)
      expect(body.tools[0].description).toBe(fullDescription);
      // Property descriptions preserved
      expect(body.tools[0].input_schema.properties.prompt.description).toBe(
        'Task instructions for the sub-agent',
      );
      expect(body.tools[0].input_schema.properties.model.description).toBe(
        'Model override (optional)',
      );
    });

    it('caps extremely long Anthropic tool descriptions at 2000 characters', async () => {
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

      const longDescription = 'X'.repeat(3000);

      await service.sendMessage([{ role: 'user', content: 'test' }], {
        tools: [
          {
            name: 'big_tool',
            description: longDescription,
            input_schema: { type: 'object', properties: {} },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].description.length).toBe(2000);
      expect(body.tools[0].description.endsWith('...')).toBe(true);
    });

    it('preserves Anthropic schema descriptions for array items and nested objects', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'test' }], {
        tools: [
          {
            name: 'multi_tool',
            description: 'A tool with nested schemas.',
            input_schema: {
              type: 'object',
              properties: {
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of tags to apply',
                },
                config: {
                  type: 'object',
                  description: 'Configuration options',
                  properties: {
                    verbose: { type: 'boolean', description: 'Enable verbose output' },
                  },
                },
              },
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const schema = body.tools[0].input_schema;
      expect(schema.properties.tags.description).toBe('List of tags to apply');
      expect(schema.properties.config.description).toBe('Configuration options');
      expect(schema.properties.config.properties.verbose.description).toBe('Enable verbose output');
    });

    it('normalizes MCP-style array item schemas for Anthropic tool declarations', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'test' }], {
        tools: [
          {
            name: 'mcp__atars__get_multi_indicator',
            description: 'Retrieve multiple indicators.',
            input_schema: {
              type: 'object',
              properties: {
                indicators: {
                  type: 'array',
                  items: {
                    description: 'Indicator code',
                    enum: ['rsi', 'macd'],
                  },
                },
              },
              required: ['indicators'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const schema = body.tools[0].input_schema;

      expect(schema.properties.indicators.items.type).toBe('string');
      expect(schema.properties.indicators.items.description).toBe('Indicator code');
      expect(schema.properties.indicators.items.enum).toEqual(['rsi', 'macd']);
    });
  });
});
