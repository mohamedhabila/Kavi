// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Gemini structured output
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Gemini structured output', () => {
    it('restricts Gemini native function calling to one exact tool when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
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

      const result = await service.sendMessage(
        [{ role: 'user', content: 'Return the pilot report.' }],
        {
          tools: [
            {
              name: 'pilot_report',
              description: 'Return the pilot report',
              input_schema: {
                type: 'object',
                properties: { approved: { type: 'boolean' } },
                required: ['approved'],
                additionalProperties: false,
              },
            },
          ],
          toolChoice: { type: 'tool', name: 'pilot_report', disableParallelToolUse: true },
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.toolConfig).toEqual({
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['pilot_report'],
        },
      });
      expect(result?.providerResponse).toEqual({
        provider: 'gemini',
        response: expect.objectContaining({
          candidates: expect.any(Array),
        }),
      });
    });

    it('adds Gemini structured output schema when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              { content: { parts: [{ text: '{"approved":true}' }] }, finishReason: 'STOP' },
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

      const result = await service.sendMessage(
        [{ role: 'user', content: 'Return the pilot report.' }],
        {
          tools: [
            {
              name: 'pilot_report',
              description: 'Return the pilot report',
              input_schema: {
                type: 'object',
                properties: { approved: { type: 'boolean' } },
                required: ['approved'],
                additionalProperties: false,
              },
            },
          ],
          toolChoice: { type: 'tool', name: 'pilot_report', disableParallelToolUse: true },
          structuredOutput: {
            name: 'pilot_report',
            mimeType: 'application/json',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                approved: { type: 'boolean' },
                completionScore: {
                  type: 'integer',
                  enum: [0, 1, 2, 3, 4, 5],
                  description: 'Completion score.',
                },
              },
              required: ['approved', 'completionScore'],
            },
          },
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(
        expect.objectContaining({
          responseFormat: {
            text: expect.objectContaining({
              mimeType: 'application/json',
            }),
          },
        }),
      );
      expect(body.generationConfig.responseFormat.text.schema).toEqual(
        expect.objectContaining({
          type: 'object',
          additionalProperties: false,
          properties: expect.objectContaining({
            approved: expect.objectContaining({ type: 'boolean' }),
            completionScore: expect.objectContaining({
              type: 'integer',
              enum: [0, 1, 2, 3, 4, 5],
              description: 'Completion score.',
            }),
          }),
        }),
      );
      expect(body.toolConfig).toEqual({
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['pilot_report'],
        },
      });
      expect(result?.output_parsed).toEqual({ approved: true });
    });

    it('disables surfaced Gemini thinking by default for structured-output requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              { content: { parts: [{ text: '{"approved":true}' }] }, finishReason: 'STOP' },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://aiplatform.googleapis.com/v1',
          apiKey: 'AIza-test',
          model: 'gemini-3.5-flash',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          mimeType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(
        expect.objectContaining({
          responseMimeType: 'application/json',
          responseSchema: expect.any(Object),
          thinkingConfig: {
            thinkingLevel: 'MINIMAL',
            includeThoughts: false,
          },
        }),
      );
    });

    it('keeps Gemini 2.5 Pro on the documented minimum thinking budget by default for structured-output requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              { content: { parts: [{ text: '{"approved":true}' }] }, finishReason: 'STOP' },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://aiplatform.googleapis.com/v1',
          apiKey: 'AIza-test',
          model: 'gemini-2.5-pro',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          mimeType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(
        expect.objectContaining({
          responseMimeType: 'application/json',
          responseSchema: expect.any(Object),
          thinkingConfig: {
            thinkingBudget: 128,
            includeThoughts: false,
          },
        }),
      );
    });

    it('uses Gemini native structured output even when configured with the OpenAI-style Gemini endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              { content: { parts: [{ text: '{"approved":true}' }] }, finishReason: 'STOP' },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
      );

      const result = await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          name: 'pilot_report',
          mimeType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result?.output_parsed).toEqual({ approved: true });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(
        expect.objectContaining({
          responseFormat: {
            text: expect.objectContaining({
              mimeType: 'application/json',
              schema: expect.objectContaining({
                type: 'object',
                properties: expect.objectContaining({
                  approved: expect.objectContaining({ type: 'boolean' }),
                }),
              }),
            }),
          },
        }),
      );
      expect(body.response_format).toBeUndefined();
    });

    it('uses the Vertex publisher-model endpoint and Vertex structured-output fields for native Gemini requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'vertex ok' }] }, finishReason: 'STOP' }],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini-vertex',
          name: 'Gemini',
          baseUrl: 'https://aiplatform.googleapis.com/v1',
          apiKey: 'AIza-vertex',
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          mimeType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3-flash-preview:generateContent',
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(
        expect.objectContaining({
          responseMimeType: 'application/json',
          responseSchema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              approved: expect.objectContaining({ type: 'boolean' }),
            }),
          }),
        }),
      );
      expect(body.generationConfig.responseFormat).toBeUndefined();
    });

    it('keeps Gemini structured output enabled for no-tool requests on older Gemini models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              { content: { parts: [{ text: '{"approved":true}' }] }, finishReason: 'STOP' },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: 'AIza-test',
          model: 'gemini-2.5-flash',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          mimeType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(
        expect.objectContaining({
          responseFormat: {
            text: expect.objectContaining({
              mimeType: 'application/json',
              schema: expect.objectContaining({
                type: 'object',
                properties: expect.objectContaining({
                  approved: expect.objectContaining({ type: 'boolean' }),
                }),
              }),
            }),
          },
        }),
      );
      expect(body.tools).toBeUndefined();
      expect(body.toolConfig).toBeUndefined();
    });
  });
});
