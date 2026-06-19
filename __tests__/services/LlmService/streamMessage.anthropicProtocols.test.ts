// ---------------------------------------------------------------------------
// Tests - LLM Service: streamMessage Anthropic protocol handling
// ---------------------------------------------------------------------------

import {
  createMockStreamResponse,
  LlmService,
  makeConfig,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('streamMessage Anthropic protocol handling', () => {
    it('should propagate Anthropic streaming errors instead of swallowing them', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () =>
          Promise.resolve(
            'event: message_start\n' +
              'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Partial"}}\n\n' +
              'event: error\n' +
              'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
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

      await expect(async () => {
        const events: any[] = [];
        for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
          events.push(event);
        }
      }).rejects.toThrow('Anthropic overloaded_error: Overloaded');
    });

    it('should continue past JSON parse errors in OpenAI streaming without swallowing real errors', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Good"}}]}\n\n',
        'data: {not valid json}\n\n',
        'data: {"choices":[{"delta":{"content":" day"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual([
        'Good',
        ' day',
      ]);
    });

    it('should omit the deprecated anthropic-beta header for Claude 4.6 adaptive thinking requests', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
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

      expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
        'anthropic-version': '2023-06-01',
      });
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('anthropic-beta');
    });

    it('should include anthropic-beta header for manual Claude 4 tool-use thinking requests that still require it', async () => {
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
          model: 'claude-sonnet-4-5',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        thinking: { type: 'enabled', budget_tokens: 2048 },
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

      expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
        'anthropic-beta': 'interleaved-thinking-2025-05-14',
        'anthropic-version': '2023-06-01',
      });
    });

    it('should merge consecutive user messages for Anthropic alternation requirement', async () => {
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
        { role: 'user', content: 'First question.' },
        { role: 'user', content: 'Follow up.' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toEqual({
        role: 'user',
        content: 'First question.\n\nFollow up.',
      });
    });

    it('should merge consecutive assistant messages for Anthropic alternation requirement', async () => {
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
        { role: 'user', content: 'Start.' },
        { role: 'assistant', content: 'Reply one.' } as any,
        { role: 'assistant', content: 'Reply two.' } as any,
        { role: 'user', content: 'Continue.' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toHaveLength(3);
      expect(body.messages[0]).toEqual({ role: 'user', content: 'Start.' });
      // Merged assistant: two text blocks in array form
      expect(body.messages[1].role).toBe('assistant');
      expect(body.messages[1].content).toEqual([
        { type: 'text', text: 'Reply one.' },
        { type: 'text', text: 'Reply two.' },
      ]);
      expect(body.messages[2]).toEqual({ role: 'user', content: 'Continue.' });
    });

    it('should use array content form for Anthropic assistant messages with tool_use', async () => {
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
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"x.txt"}' },
            },
          ],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'contents' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg.content).toEqual([
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'x.txt' } },
      ]);
    });

    it('should set is_error on Anthropic tool_result when content starts with Error:', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'I see the error' }],
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
        { role: 'user', content: 'Run javascript.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'javascript', arguments: '{}' },
            },
          ],
        } as any,
        {
          role: 'tool',
          tool_call_id: 'toolu_1',
          content: 'Error: "code" is required for javascript and must be a string',
        },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const toolResultMsg = body.messages.find(
        (m: any) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.some((b: any) => b.type === 'tool_result'),
      );
      const toolResult = toolResultMsg.content.find((b: any) => b.type === 'tool_result');
      expect(toolResult.is_error).toBe(true);
    });

    it('should set is_error on Anthropic tool_result when is_error flag is passed through', async () => {
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

      await service.sendMessage([
        { role: 'user', content: 'Do something.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"x.txt"}' },
            },
          ],
        } as any,
        {
          role: 'tool',
          tool_call_id: 'toolu_1',
          content: 'Error: Permission denied',
          is_error: true,
        } as any,
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const toolResultMsg = body.messages.find(
        (m: any) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.some((b: any) => b.type === 'tool_result'),
      );
      const toolResult = toolResultMsg.content.find((b: any) => b.type === 'tool_result');
      expect(toolResult.is_error).toBe(true);
    });

    it('should not set is_error on successful Anthropic tool_result', async () => {
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
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"x.txt"}' },
            },
          ],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents here' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const toolResultMsg = body.messages.find(
        (m: any) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.some((b: any) => b.type === 'tool_result'),
      );
      const toolResult = toolResultMsg.content.find((b: any) => b.type === 'tool_result');
      expect(toolResult.is_error).toBeUndefined();
    });
  });
});
