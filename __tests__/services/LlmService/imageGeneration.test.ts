// ---------------------------------------------------------------------------
// Tests - LLM Service: image generation and editing
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('image generation and editing', () => {
    it('uses the OpenAI image generations endpoint and returns base64 image data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            output_format: 'png',
            data: [
              {
                b64_json: 'abc123',
                revised_prompt: 'revised prompt',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-image-2',
        }),
      );

      const result = await service.generateImage({
        prompt: 'A retro robot poster',
        quality: 'high',
        format: 'png',
      });

      expect(result.b64_json).toBe('abc123');
      expect(result.revisedPrompt).toBe('revised prompt');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toBe('A retro robot poster');
      expect(body.model).toBe('gpt-image-2');
      expect(body.output_format).toBe('png');
      expect(body.quality).toBe('high');
    });

    it('normalizes image generation usage metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            output_format: 'png',
            data: [
              {
                b64_json: 'abc123',
              },
            ],
            usage: {
              input_tokens: 120,
              output_tokens: 480,
              total_tokens: 600,
              input_tokens_details: {
                text_tokens: 20,
                image_tokens: 100,
              },
              output_tokens_details: {
                image_tokens: 480,
              },
            },
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-image-2',
        }),
      );

      const result = await service.generateImage({
        prompt: 'A retro robot poster',
        format: 'png',
      });

      expect(result.usage).toEqual(
        expect.objectContaining({
          model: 'gpt-image-2',
          inputTokens: 120,
          outputTokens: 480,
          totalTokens: 600,
          tokenDetails: expect.objectContaining({
            inputImageTokens: 100,
            outputImageTokens: 480,
          }),
        }),
      );
    });

    it('uses Gemini generateContent for Gemini providers with an explicit user role', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: 'image/png', data: 'gemini-image' } }],
                },
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Google Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gemini-key',
          model: 'gemini-3.1-flash-image',
        }),
      );

      const result = await service.generateImage({ prompt: 'A watercolor fox', size: '1024x1024' });

      expect(result.b64_json).toBe('gemini-image');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'A watercolor fox' }] }]);
      expect(body.generationConfig).toEqual({
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '1K',
        },
      });
    });

    it('uses the Vertex publisher-model endpoint for Gemini image generation on Vertex providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: 'image/png', data: 'vertex-image' } }],
                },
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini-vertex-image',
          name: 'Gemini',
          baseUrl: 'https://aiplatform.googleapis.com/v1',
          apiKey: 'gemini-key',
          model: 'gemini-3.1-flash-image',
        }),
      );

      const result = await service.generateImage({ prompt: 'A watercolor fox' });

      expect(result.b64_json).toBe('vertex-image');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-image:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
        }),
      );
    });

    it('surfaces Gemini prompt blocks during image generation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            promptFeedback: {
              blockReason: 'IMAGE_SAFETY',
            },
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Google Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gemini-key',
          model: 'gemini-3.1-flash-image',
        }),
      );

      await expect(service.generateImage({ prompt: 'A violent scene' })).rejects.toThrow(
        'Gemini image prompt blocked: IMAGE_SAFETY',
      );
    });

    it('surfaces Gemini no-image finish reasons during image generation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                finishReason: 'NO_IMAGE',
                content: {
                  parts: [{ text: 'No image could be produced.' }],
                },
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Google Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gemini-key',
          model: 'gemini-3.1-flash-image',
        }),
      );

      await expect(service.generateImage({ prompt: 'A portrait' })).rejects.toThrow(
        'Gemini image generation returned no image data (finish reason: no_image)',
      );
    });

    it('throws for anthropic providers', async () => {
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
        }),
      );

      await expect(service.generateImage({ prompt: 'A portrait' })).rejects.toThrow(
        'Anthropic image generation is not supported',
      );
    });

    it('uses the OpenAI image edits endpoint and normalizes usage', async () => {
      class MockFormData {
        entries: Array<[string, unknown]> = [];

        append(name: string, value: unknown) {
          this.entries.push([name, value]);
        }
      }

      const originalFormData = global.FormData;
      (global as typeof globalThis & { FormData: typeof MockFormData }).FormData =
        MockFormData as any;

      try {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              output_format: 'webp',
              data: [
                {
                  b64_json: 'edited123',
                  revised_prompt: 'edited prompt',
                },
              ],
              usage: {
                input_tokens: 80,
                output_tokens: 320,
                total_tokens: 400,
              },
            }),
        });

        const service = new LlmService(
          makeConfig({
            id: 'openai',
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-openai',
            model: 'gpt-image-2',
          }),
        );

        const result = await service.editImage({
          prompt: 'Add a red scarf',
          images: [
            {
              uri: 'file:///tmp/source.png',
              name: 'source.png',
              mimeType: 'image/png',
            },
          ],
          mask: {
            uri: 'file:///tmp/mask.png',
            name: 'mask.png',
            mimeType: 'image/png',
          },
          format: 'webp',
          inputFidelity: 'high',
          outputCompression: 82,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.openai.com/v1/images/edits',
          expect.objectContaining({ method: 'POST' }),
        );

        const body = mockFetch.mock.calls[0][1].body as MockFormData;
        const fieldNames = body.entries.map(([name]) => name);
        expect(fieldNames).toEqual(
          expect.arrayContaining([
            'model',
            'prompt',
            'image',
            'mask',
            'output_format',
            'input_fidelity',
            'output_compression',
          ]),
        );

        expect(result).toEqual(
          expect.objectContaining({
            b64_json: 'edited123',
            revisedPrompt: 'edited prompt',
            outputFormat: 'webp',
            usage: expect.objectContaining({
              model: 'gpt-image-2',
              inputTokens: 80,
              outputTokens: 320,
              totalTokens: 400,
            }),
          }),
        );
      } finally {
        (global as typeof globalThis & { FormData: typeof MockFormData | undefined }).FormData =
          originalFormData as any;
      }
    });

    it('uses Gemini generateContent for image edits with inline image data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: 'image/png', data: 'gemini-edited' } }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 64,
              candidatesTokenCount: 256,
              totalTokenCount: 320,
            },
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Google Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gemini-key',
          model: 'gemini-3.1-flash-image',
        }),
      );

      const result = await service.editImage({
        prompt: 'Add dramatic studio lighting',
        images: [
          {
            uri: 'file:///tmp/source.png',
            name: 'source.png',
            mimeType: 'image/png',
            dataUri: 'data:image/png;base64,AAAA',
          },
        ],
        size: '1024x1024',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
            { text: 'Add dramatic studio lighting' },
          ],
        },
      ]);

      expect(result).toEqual(
        expect.objectContaining({
          b64_json: 'gemini-edited',
          usage: expect.objectContaining({
            model: 'gemini-3.1-flash-image',
            inputTokens: 64,
            outputTokens: 256,
            totalTokens: 320,
          }),
        }),
      );
    });
  });
});
