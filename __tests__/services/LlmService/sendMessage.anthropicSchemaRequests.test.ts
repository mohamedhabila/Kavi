// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic schema and request shaping
// ---------------------------------------------------------------------------

import {
  LlmService,
  makeConfig,
  makeExpoFailureToolResult,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic schema and request shaping', () => {
    it('caps Anthropic strict tools before the first request', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Use a tool if needed.' }], {
        tools: Array.from({ length: 8 }, (_, index) => ({
          name: `tool_${index}`,
          description: `Tool ${index}. Extra detail that Anthropic does not need in the first pass.`,
          strict: true,
          input_schema: {
            type: 'object',
            properties: {
              value: { type: 'string', description: 'Value to pass to the tool' },
            },
            required: ['value'],
          },
        })),
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(8);
      expect(body.tools.filter((tool: any) => tool.strict === true)).toHaveLength(4);
      expect(body.tools.slice(0, 4).every((tool: any) => tool.strict === true)).toBe(true);
      expect(body.tools.slice(4).every((tool: any) => tool.strict === undefined)).toBe(true);
      // Anthropic tool descriptions are no longer truncated to first sentence —
      // full descriptions are preserved per Anthropic best practices.
      expect(body.tools[0].description).toBe(
        'Tool 0. Extra detail that Anthropic does not need in the first pass.',
      );
      // Property descriptions are preserved for Anthropic (Claude relies on them).
      expect(body.tools[0].input_schema.properties.value.description).toBe(
        'Value to pass to the tool',
      );
    });

    it('does not mark complex Anthropic schemas strict even when the tool requests it', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Use a tool if needed.' }], {
        tools: [
          {
            name: 'complex_tool',
            description: 'Complex tool. More detail that should be trimmed.',
            strict: true,
            input_schema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                count: { type: 'number', description: 'Number of results' },
                filters: {
                  type: 'object',
                  properties: {
                    country: { type: 'string', description: 'Country filter' },
                  },
                  required: ['country'],
                },
              },
              required: ['query'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].strict).toBeUndefined();
      expect(body.tools[0].description).toBe('Complex tool. More detail that should be trimmed.');
      expect(body.tools[0].input_schema).toEqual({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results' },
          filters: {
            type: 'object',
            properties: {
              country: { type: 'string', description: 'Country filter' },
            },
            required: ['country'],
          },
        },
        required: ['query'],
      });
    });

    it('keeps Anthropic tool_use and tool_result messages properly paired', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Done' }],
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

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Run the tool.' },
          {
            role: 'assistant',
            content: 'Checking the file.',
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              },
            ],
          } as any,
          { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' },
        ],
        {
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
          toolChoice: 'required',
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toBe('You are helpful.');
      expect(body.tool_choice).toEqual({ type: 'any' });
      expect(body.messages).toEqual([
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking the file.' },
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents' }],
        },
      ]);
    });

    it('reorders Anthropic user content so tool_result blocks come before text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Done' }],
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

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'toolu_2',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
            },
          ],
        } as any,
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What should I do next?' },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'file contents' },
          ],
        } as any,
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: { path: 'notes.txt' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'file contents' },
            { type: 'text', text: 'What should I do next?' },
          ],
        },
      ]);
    });

    it('replays Expo failure tool results to Anthropic tool_result content unchanged', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Done' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 4 },
          }),
      });

      const expoFailureResult = makeExpoFailureToolResult();
      const expoFailureText = JSON.stringify(expoFailureResult);
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
          { role: 'user', content: 'Check Expo workflow status.' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'toolu_expo_1',
                type: 'function',
                function: {
                  name: 'expo_eas_workflow_status',
                  arguments: '{"projectId":"expo-1","runId":"workflow-run-77"}',
                },
              },
            ],
          } as any,
          {
            role: 'tool',
            tool_call_id: 'toolu_expo_1',
            name: 'expo_eas_workflow_status',
            content: expoFailureText,
          } as any,
        ],
        {
          tools: [
            {
              name: 'expo_eas_workflow_status',
              description: 'Inspect Expo workflow status.',
              input_schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string' },
                  runId: { type: 'string' },
                },
                required: ['projectId'],
              },
            },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Check Expo workflow status.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_expo_1',
              name: 'expo_eas_workflow_status',
              input: { projectId: 'expo-1', runId: 'workflow-run-77' },
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_expo_1', content: expoFailureText }],
        },
      ]);
    });
  });
});
