// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic thinking replay shaping
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic thinking replay shaping', () => {
    it('drops thinking-only assistant history before a fresh user turn', async () => {
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
          model: 'claude-haiku-4-5',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'First task' },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Internal reasoning that had no visible output.',
              signature: 'sig-thinking-only',
            },
          ],
        } as any,
        { role: 'user', content: 'Second task' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([{ role: 'user', content: 'First task\n\nSecond task' }]);
      expect(JSON.stringify(body.messages)).not.toContain('thinking');
    });

    it('keeps visible assistant text while removing unpaired thinking history', async () => {
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
          model: 'claude-haiku-4-5',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'First task' },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Internal reasoning before a visible answer.',
              signature: 'sig-visible-answer',
            },
            { type: 'text', text: 'Completed first task.' },
          ],
        } as any,
        { role: 'user', content: 'Second task' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'First task' },
        { role: 'assistant', content: 'Completed first task.' },
        { role: 'user', content: 'Second task' },
      ]);
      expect(JSON.stringify(body.messages)).not.toContain('thinking');
    });

    it('preserves thinking blocks when they are paired with tool use', async () => {
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
          model: 'claude-haiku-4-5',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'I need the file contents.',
              signature: 'sig-tool-use',
            },
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
          ],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' } as any,
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'I need the file contents.',
            signature: 'sig-tool-use',
          },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
    });
  });
});
