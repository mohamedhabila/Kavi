// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage OpenAI prompt cache
// ---------------------------------------------------------------------------

import {
  LlmService,
  normalizeOpenAIPromptCacheKey,
  OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
  makeConfig,
  makeOpenAIResponsesPayload,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage OpenAI prompt cache', () => {
    it('adds OpenAI prompt cache hints when enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheKey: 'cm:test:key',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt_cache_key).toBe('cm:test:key');
      expect(body.prompt_cache_retention).toBe('24h');
    });

    it('does not add OpenAI prompt cache hints for custom Responses-compatible providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'responses-compatible',
          name: 'Responses Compatible',
          baseUrl: 'https://responses-compatible.example.com/v1',
          apiKey: 'sk-compatible',
          model: 'custom-responses-model',
          capabilityHints: {
            supportsResponsesApi: true,
          },
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheKey: 'cm:should-not-forward',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt_cache_key).toBeUndefined();
      expect(body.prompt_cache_retention).toBeUndefined();
    });

    it('preserves graph-selected tool order for cache-aware OpenAI requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheKey: 'cm:test:key',
        tools: [
          {
            name: 'browser_navigate',
            description: 'Navigate to a page.',
            input_schema: {
              type: 'object',
              properties: { url: { type: 'string' } },
              required: ['url'],
            },
          },
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
            name: 'tool_catalog',
            description: 'Inspect deferred tool categories.',
            input_schema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools.map((tool: any) => tool.name)).toEqual([
        'browser_navigate',
        'read_file',
        'tool_catalog',
      ]);
    });

    it('keeps cacheable system sections in instructions and moves dynamic context to the tail', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage(
        [
          {
            role: 'system',
            content: 'Stable assistant contract.\n\nDynamic memory and focus.',
          },
          { role: 'user', content: 'Earlier durable user context.' },
          { role: 'assistant', content: 'Earlier assistant response.' },
          { role: 'user', content: 'Current user request.' },
        ],
        {
          enablePromptCaching: true,
          promptCacheKey: 'cm:test:key',
          systemPromptSections: [
            { text: 'Stable assistant contract.', cacheable: true },
            { text: 'Dynamic memory and focus.' },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.instructions).toBe('Stable assistant contract.');
      expect(body.input).toEqual([
        { role: 'user', content: 'Earlier durable user context.' },
        { role: 'assistant', content: 'Earlier assistant response.' },
        { role: 'user', content: 'Current user request.' },
        { role: 'system', content: 'Dynamic memory and focus.' },
      ]);
    });

    it('persists dynamic input context in OpenAI replay metadata for stateless cache growth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      const result = await service.sendMessage([{ role: 'user', content: 'Current request.' }], {
        enablePromptCaching: true,
        promptCacheKey: 'cm:test:key',
        systemPromptSections: [
          { text: 'Stable assistant contract.', cacheable: true },
          { text: 'Dynamic memory and focus.' },
        ],
      });

      expect(result.choices[0].message.providerReplay.openaiResponseInputContext).toEqual([
        { role: 'system', content: 'Dynamic memory and focus.' },
      ]);
    });

    it('replays prior OpenAI dynamic input context before prior assistant output', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage(
        [
          { role: 'user', content: 'Earlier request.' },
          {
            role: 'assistant',
            content: 'Earlier response.',
            providerReplay: {
              openaiResponseInputContext: [{ role: 'system', content: 'Previous dynamic memory.' }],
              openaiResponseOutput: [
                {
                  id: 'msg_prev',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: 'Earlier response.', annotations: [] }],
                },
              ],
            },
          },
          { role: 'user', content: 'Current request.' },
        ],
        {
          enablePromptCaching: true,
          promptCacheKey: 'cm:test:key',
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual([
        { role: 'user', content: 'Earlier request.' },
        { role: 'system', content: 'Previous dynamic memory.' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Earlier response.', annotations: [] }],
        },
        { role: 'user', content: 'Current request.' },
      ]);
    });

    it('compacts oversized OpenAI prompt cache keys before serialization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.1-codex-mini',
        }),
      );

      const rawKey =
        'cm:openai-enterprise-production:gpt-5.1-codex-mini:sub-1743476400000-mchsvm1f_abc123_7';

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheKey: rawKey,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt_cache_key).toBe(normalizeOpenAIPromptCacheKey(rawKey));
      expect(body.prompt_cache_key.length).toBeLessThanOrEqual(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
      expect(body.prompt_cache_retention).toBe('24h');
    });

    it('normalizes legacy OpenAI prompt cache retention values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheRetention: 'in-memory',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt_cache_retention).toBe('in_memory');
    });
  });
});
