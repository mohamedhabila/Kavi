// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Gemini cache basics
// ---------------------------------------------------------------------------

import {
  getGeminiPromptCacheTelemetrySnapshot,
  LlmService,
  makeConfig,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Gemini cache basics', () => {
    it('does not forward generic prompt cache keys to Gemini native generateContent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Use the cache' },
        ],
        {
          enablePromptCaching: true,
          promptCacheKey: 'cm:test:key',
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cachedContent).toBeUndefined();
    });

    it('keeps stable core tools at the front of cache-aware Gemini requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Use the cache' },
        ],
        {
          enablePromptCaching: true,
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
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].functionDeclarations.map((tool: any) => tool.name)).toEqual([
        'browser_navigate',
        'read_file',
        'tool_catalog',
      ]);
    });

    it('ignores native Gemini cachedContents handles and relies on implicit caching', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'Stable instructions\n\nRuntime note' },
          { role: 'user', content: 'Use the cache' },
        ],
        {
          enablePromptCaching: true,
          promptCacheKey: 'projects/test/locations/us-central1/cachedContents/native-cache-123',
          systemPromptSections: [
            { text: 'Stable instructions', cacheable: true },
            { text: 'Runtime note' },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cachedContent).toBeUndefined();
      expect(body.systemInstruction).toEqual({
        parts: [{ text: 'Stable instructions' }],
      });
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'Use the cache' }] },
        { role: 'user', parts: [{ text: 'Runtime note' }] },
      ]);
    });

    it('ignores external Gemini cachedContents handles with live tools', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'Stable instructions' },
          { role: 'user', content: 'Use the tool' },
        ],
        {
          enablePromptCaching: true,
          promptCacheKey: 'projects/test/locations/us-central1/cachedContents/native-cache-123',
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
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cachedContent).toBeUndefined();
      expect(body.tools[0].functionDeclarations[0].name).toBe('read_file');
      expect(body.toolConfig).toEqual({
        functionCallingConfig: { mode: 'ANY' },
      });
    });

    it('records Gemini implicit cache telemetry without creating cachedContents', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
      );
      const promptCacheTelemetry = {
        eligible: true,
        enabled: true,
        estimatedInputTokens: 4096,
        thresholdTokens: 4096,
        providerFamily: 'gemini',
        hostedFamily: 'gemini',
        mode: 'gemini_native' as const,
        event: 'provider_managed' as const,
        reason: 'managed_or_implicit_cache',
      };

      await service.sendMessage(
        [
          { role: 'system', content: 'Stable instructions\n\nRuntime note' },
          { role: 'user', content: 'Use the cache' },
        ],
        {
          enablePromptCaching: true,
          systemPromptSections: [
            { text: 'Stable instructions', cacheable: true },
            { text: 'Runtime note' },
          ],
          usageTelemetry: {
            promptCache: promptCacheTelemetry,
          },
        },
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cachedContent).toBeUndefined();
      expect(body.systemInstruction).toEqual({
        parts: [{ text: 'Stable instructions' }],
      });
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'Use the cache' }] },
        { role: 'user', parts: [{ text: 'Runtime note' }] },
      ]);
      expect(promptCacheTelemetry).toMatchObject({
        event: 'provider_managed',
        reason: 'gemini_implicit_cache',
      });
      expect(promptCacheTelemetry).not.toHaveProperty('explicitCacheName');
      expect(getGeminiPromptCacheTelemetrySnapshot()).toMatchObject({
        cacheCreateAttempts: 0,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      });
    });
  });
});
