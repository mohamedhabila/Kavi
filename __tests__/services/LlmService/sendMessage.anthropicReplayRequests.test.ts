// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic replay request shaping
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic replay request shaping', () => {
    it('sanitizes legacy Anthropic assistant content arrays with empty text blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Recovered' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 12, output_tokens: 6 },
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
          { role: 'user', content: 'Sort [3,1,2] using javascript.' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: '' },
              { type: 'tool_use', id: 'toolu_1', name: 'javascript', input: {} },
            ],
          } as any,
          {
            role: 'tool',
            tool_call_id: 'toolu_1',
            name: 'javascript',
            content: "Error: 'code' is required for javascript and must be a string",
            is_error: true,
          } as any,
        ],
        {
          tools: [
            {
              name: 'javascript',
              description: 'Execute JavaScript',
              input_schema: {
                type: 'object',
                properties: { code: { type: 'string' } },
                required: ['code'],
              },
            },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Sort [3,1,2] using javascript.' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'javascript', input: {} }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: "Error: 'code' is required for javascript and must be a string",
              is_error: true,
            },
          ],
        },
      ]);
    });

    it('drops stale Anthropic tool_use history before a later fresh user turn', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Handled safely' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 12, output_tokens: 6 },
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
          { role: 'user', content: 'First task' },
          {
            role: 'assistant',
            content: 'Checking the file.',
            tool_calls: [
              {
                id: 'toolu_stale_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              },
            ],
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          } as any,
          { role: 'user', content: 'New question after the failed turn.' },
        ],
        {
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
      expect(body.messages).toEqual([
        { role: 'user', content: 'First task' },
        { role: 'assistant', content: 'Checking the file.' },
        { role: 'user', content: 'New question after the failed turn.' },
      ]);
    });

    it('strips Anthropic thinking replay from prior plain assistant turns before a later user follow-up', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Handled safely' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 12, output_tokens: 6 },
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
        { role: 'user', content: 'First task' },
        {
          role: 'assistant',
          content: 'Completed first task.',
          providerReplay: {
            anthropicBlocks: [
              {
                type: 'thinking',
                thinking: 'I should think before answering.',
                signature: 'sig-A',
              },
              { type: 'text', text: 'Completed first task.' },
            ],
          },
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'end_turn',
          },
        } as any,
        { role: 'user', content: 'Second task' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'First task' },
        { role: 'assistant', content: 'Completed first task.' },
        { role: 'user', content: 'Second task' },
      ]);
    });

    it('converts OpenAI image_url user content to Anthropic image blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'It is a tiny PNG.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 8, output_tokens: 5 },
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
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'high' } },
          ],
        },
      ] as any);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'abc',
              },
            },
          ],
        },
      ]);
    });
  });
});
