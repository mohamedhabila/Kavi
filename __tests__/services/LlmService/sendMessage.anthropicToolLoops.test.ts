// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic tool loops
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic tool loops', () => {
    it('disables Anthropic thinking while continuing a tool loop without replayable thinking blocks', async () => {
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
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
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
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
    });

    it('drops partial Anthropic signed replay blocks when they do not cover every tool call', async () => {
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
          { role: 'user', content: 'Run the tools.' },
          {
            role: 'assistant',
            content: '',
            providerReplay: {
              anthropicBlocks: [
                {
                  type: 'thinking',
                  thinking: 'I should inspect both tools first.',
                  signature: 'sig-A',
                },
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
              {
                id: 'toolu_2',
                type: 'function',
                function: { name: 'list_dir', arguments: '{"path":"."}' },
              },
            ],
          } as any,
          { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' } as any,
          { role: 'tool', tool_call_id: 'toolu_2', content: 'directory contents' } as any,
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
            {
              name: 'list_dir',
              description: 'List a directory.',
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
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
          { type: 'tool_use', id: 'toolu_2', name: 'list_dir', input: { path: '.' } },
        ],
      });
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
    });

    it('keeps Anthropic thinking enabled while continuing a tool loop with replayable thinking blocks', async () => {
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
                {
                  type: 'thinking',
                  thinking: 'I should inspect the file first.',
                  signature: 'sig-A',
                },
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
          temperature: 0.2,
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
          { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
      expect(body.temperature).toBeUndefined();
    });

    it('replays Anthropic providerReplay blocks when raw tool metadata is unavailable', async () => {
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
                {
                  type: 'thinking',
                  thinking: 'I should inspect the file first.',
                  signature: 'sig-A',
                },
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
          { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
    });
  });
});
