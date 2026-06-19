// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Anthropic cache controls
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Anthropic cache controls', () => {
    it('adds Anthropic automatic cache control when enabled', async () => {
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
        enablePromptCaching: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('adds Anthropic explicit cache breakpoints for stable system and tool prefixes', async () => {
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
          { role: 'system', content: 'Stable core\n\nDynamic tail' },
          { role: 'user', content: 'Hello' },
        ],
        {
          enablePromptCaching: true,
          systemPromptSections: [
            { text: 'Stable core', cacheable: true },
            { text: 'Dynamic tail', cacheable: false },
          ],
          tools: [
            {
              name: 'browser_navigate',
              description: 'Navigate to a page.',
              input_schema: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                },
                required: ['url'],
              },
            },
            {
              name: 'read_file',
              description: 'Read a file.',
              input_schema: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                },
                required: ['path'],
              },
            },
            {
              name: 'tool_catalog',
              description: 'Inspect deferred tool categories.',
              input_schema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cache_control).toEqual({ type: 'ephemeral' });
      expect(body.system).toEqual([
        { type: 'text', text: 'Stable core', cache_control: { type: 'ephemeral' } },
      ]);
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello\n\nDynamic tail' }]);
      expect(body.tools.map((tool: any) => tool.name)).toEqual([
        'browser_navigate',
        'read_file',
        'tool_catalog',
      ]);
      expect(body.tools[0].cache_control).toBeUndefined();
      expect(body.tools[1].cache_control).toBeUndefined();
      expect(body.tools[2].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('does not mark late cacheable-looking system sections after dynamic context as prefix cacheable', async () => {
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
        enablePromptCaching: true,
        systemPromptSections: [
          { text: 'Stable core', cacheable: true },
          { text: 'Dynamic turn context' },
          { text: 'Late memory block', cacheable: true },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toEqual([
        { type: 'text', text: 'Stable core', cache_control: { type: 'ephemeral' } },
      ]);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Hello\n\nDynamic turn context\n\nLate memory block' },
      ]);
    });

    it('marks reusable history messages without marking the volatile current turn', async () => {
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
          { role: 'user', content: 'First request' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second request' },
          { role: 'assistant', content: 'Second response' },
          { role: 'user', content: 'Current request' },
        ],
        {
          enablePromptCaching: true,
          systemPromptSections: [
            { text: 'Stable core', cacheable: true },
            { text: 'Dynamic turn context' },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cache_control).toEqual({ type: 'ephemeral' });
      expect(body.messages.at(-1)).toEqual({
        role: 'user',
        content: 'Current request\n\nDynamic turn context',
      });
      expect(body.messages.at(-1).content).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ cache_control: { type: 'ephemeral' } })]),
      );
      expect(body.messages.at(-2).content).toEqual([
        { type: 'text', text: 'Second response', cache_control: { type: 'ephemeral' } },
      ]);
      expect(body.messages.at(-3).content).toEqual([
        { type: 'text', text: 'Second request', cache_control: { type: 'ephemeral' } },
      ]);
    });
  });
});
