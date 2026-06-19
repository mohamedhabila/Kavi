// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic tool_result replay shaping
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic tool_result replay shaping', () => {
    it('merges duplicate tool_result blocks for the same Anthropic tool_use id', async () => {
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
          model: 'claude-haiku-4-5',
        }),
      );

      await service.sendMessage(
        [
          { role: 'user', content: 'Recall the preference.' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: {
                  name: 'memory_recall',
                  arguments: '{"subject":"user","predicate":"preference"}',
                },
              },
            ],
          } as any,
          { role: 'tool', tool_call_id: 'toolu_1', content: 'first result' } as any,
          {
            role: 'tool',
            tool_call_id: 'toolu_1',
            content: 'second recovery note',
            is_error: true,
          } as any,
        ],
        {
          tools: [
            {
              name: 'memory_recall',
              description: 'Recall memory.',
              input_schema: {
                type: 'object',
                properties: {
                  subject: { type: 'string' },
                  predicate: { type: 'string' },
                },
                required: ['subject'],
              },
            },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[2]).toEqual({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'first result\n\nsecond recovery note',
            is_error: true,
          },
        ],
      });
    });

    it('deduplicates tool_result ids when tool output merges with user content', async () => {
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
          model: 'claude-haiku-4-5',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'Recall the preference.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'memory_recall', arguments: '{}' },
            },
          ],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'first result' } as any,
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'second result' },
            { type: 'text', text: 'Continue.' },
          ],
        } as any,
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[2]).toEqual({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'first result\n\nsecond result',
          },
          { type: 'text', text: 'Continue.' },
        ],
      });
    });
  });
});
