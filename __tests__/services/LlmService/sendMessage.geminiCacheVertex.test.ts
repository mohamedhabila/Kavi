// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Gemini Vertex cache behavior
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Gemini Vertex cache behavior', () => {
    it('keeps changed Gemini tool declarations in live requests without explicit cache churn', async () => {
      mockFetch
        .mockResolvedValueOnce({
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
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              candidates: [
                {
                  content: { parts: [{ text: 'ok again' }] },
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
          model: 'gemini-3.5-flash',
        }),
      );

      const messages = [
        { role: 'system', content: 'Stable instructions\n\nRuntime note' },
        { role: 'user', content: 'Use the cache and call the tool' },
      ] as const;
      const baseOptions = {
        enablePromptCaching: true,
        systemPromptSections: [
          { text: 'Stable instructions', cacheable: true },
          { text: 'Runtime note' },
        ],
      };

      await service.sendMessage(messages as any, {
        ...baseOptions,
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

      await service.sendMessage(messages as any, {
        ...baseOptions,
        tools: [
          {
            name: 'read_file',
            description: 'Read a file with optional encoding.',
            input_schema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                encoding: { type: 'string' },
              },
              required: ['path'],
            },
          },
        ],
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls.map((call) => call[0])).toEqual([
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      ]);
      const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(firstBody.cachedContent).toBeUndefined();
      expect(secondBody.cachedContent).toBeUndefined();
      expect(firstBody.tools[0].functionDeclarations[0].description).toBe('Read a file.');
      expect(secondBody.tools[0].functionDeclarations[0].description).toBe(
        'Read a file with optional encoding.',
      );
    });

    it('uses implicit caching for unscoped Vertex express Gemini base URLs', async () => {
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
          id: 'gemini-vertex-express',
          name: 'Gemini',
          baseUrl: 'https://aiplatform.googleapis.com/v1',
          apiKey: 'AIza-vertex',
          model: 'gemini-3.5-flash',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'Stable instructions\n\nRuntime note' },
          { role: 'user', content: 'Use the cache' },
        ],
        {
          enablePromptCaching: true,
          conversationId: 'conversation-vertex-express',
          systemPromptSections: [
            { text: 'Stable instructions', cacheable: true },
            { text: 'Runtime note' },
          ],
        },
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash:generateContent',
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

    it('uses implicit caching for scoped Vertex Gemini base URLs', async () => {
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
          id: 'gemini-vertex',
          name: 'Gemini',
          baseUrl:
            'https://aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1',
          apiKey: 'AIza-vertex',
          model: 'gemini-3.5-flash',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'Stable instructions\n\nRuntime note' },
          { role: 'user', content: 'Use the cache' },
        ],
        {
          enablePromptCaching: true,
          conversationId: 'conversation-vertex-scoped',
          systemPromptSections: [
            { text: 'Stable instructions', cacheable: true },
            { text: 'Runtime note' },
          ],
        },
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/gemini-3.5-flash:generateContent',
      );
      const generateBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(generateBody.cachedContent).toBeUndefined();
      expect(generateBody.systemInstruction).toEqual({
        parts: [{ text: 'Stable instructions' }],
      });
      expect(generateBody.contents).toEqual([
        { role: 'user', parts: [{ text: 'Use the cache' }] },
        { role: 'user', parts: [{ text: 'Runtime note' }] },
      ]);
    });
  });
});
