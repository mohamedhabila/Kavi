// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage chat-compatible routing and provider options
// ---------------------------------------------------------------------------

import {
  LlmService,
  makeConfig,
  makeOpenAIResponsesPayload,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage chat-compatible routing and provider options', () => {
    it('adds structured output via native compatible response_format for OpenRouter-style providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: '{"approved":true}' } }] }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-openrouter',
          model: 'openai/gpt-5.4',
        }),
      );

      const result = await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          name: 'pilot_report',
          mimeType: 'application/json',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning_effort).toBe('none');
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'pilot_report',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['approved'],
            properties: {
              approved: { type: 'boolean' },
            },
          },
        },
      });
      expect(body.text).toBeUndefined();
      expect(result?.output_parsed).toEqual({ approved: true });
    });

    it('adds OpenRouter sticky session and Claude cache control without OpenAI cache fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-openrouter',
          model: 'anthropic/claude-sonnet-4-6',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Use cached context.' }], {
        enablePromptCaching: true,
        conversationId: 'conv-openrouter-cache',
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
      expect(body.session_id).toBe('conv-openrouter-cache');
      expect(body.cache_control).toEqual({ type: 'ephemeral' });
      expect(body.prompt_cache_key).toBeUndefined();
      expect(body.prompt_cache_retention).toBeUndefined();
      expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
        'browser_navigate',
        'read_file',
        'tool_catalog',
      ]);
    });

    it('uses only OpenRouter sticky sessions for non-Claude hosted models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-openrouter',
          model: 'openai/gpt-5.4',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Use cached context.' }], {
        enablePromptCaching: true,
        conversationId: 'conv-openrouter-openai',
        promptCacheKey: 'cm:should-not-forward',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.session_id).toBe('conv-openrouter-openai');
      expect(body.cache_control).toBeUndefined();
      expect(body.prompt_cache_key).toBeUndefined();
      expect(body.prompt_cache_retention).toBeUndefined();
    });

    it('keeps OpenAI-compatible cache prefixes stable while moving dynamic context to the user tail', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-openrouter',
          model: 'openai/gpt-5.4',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'Stable instructions\n\nRuntime note' },
          { role: 'user', content: 'Use cached context.' },
        ],
        {
          enablePromptCaching: true,
          conversationId: 'conv-openrouter-prefix',
          systemPromptSections: [
            { text: 'Stable instructions', cacheable: true },
            { text: 'Runtime note' },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.session_id).toBe('conv-openrouter-prefix');
      expect(body.messages).toEqual([
        { role: 'system', content: 'Stable instructions' },
        { role: 'user', content: 'Use cached context.\n\nRuntime note' },
      ]);
    });

    it('does not send cache fields to generic OpenAI-compatible gateways', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'compatible',
          name: 'Compatible Gateway',
          baseUrl: 'https://compatible.example.com/v1',
          apiKey: 'sk-compatible',
          model: 'openai/gpt-5.4',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Use cached context.' }], {
        enablePromptCaching: true,
        conversationId: 'conv-compatible-cache',
        promptCacheKey: 'cm:should-not-forward',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.session_id).toBeUndefined();
      expect(body.cache_control).toBeUndefined();
      expect(body.prompt_cache_key).toBeUndefined();
      expect(body.prompt_cache_retention).toBeUndefined();
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API key'),
      });

      const service = new LlmService(makeConfig());
      await expect(service.sendMessage([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
        'LLM API error 401',
      );
    });

    it('should use custom model when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'test' }], {
        model: 'custom-model',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('custom-model');
    });

    it('uses the shared model output budget when OpenAI-compatible callers omit maxTokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-openrouter',
          model: 'openai/gpt-5.4',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(32000);
    });

    it('should set maxTokens and temperature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'test' }], {
        maxTokens: 4096,
        temperature: 0.7,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(4096);
      expect(body.temperature).toBe(0.7);
    });

    it('uses max_output_tokens and omits temperature for OpenAI GPT-5 models', async () => {
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
        model: 'gpt-5.4',
        maxTokens: 512,
        temperature: 0.7,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_output_tokens).toBe(512);
      expect(body.temperature).toBeUndefined();
    });

    it('uses the shared model output budget when OpenAI Responses callers omit maxTokens', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Hello' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_output_tokens).toBe(32000);
    });

    it('keeps max_tokens and temperature for non-OpenAI compatible providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'custom',
          name: 'Custom',
          baseUrl: 'https://example.ai/v1',
          apiKey: 'sk-custom',
          model: 'custom-model',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        model: 'custom-model',
        maxTokens: 256,
        temperature: 0.4,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(256);
      expect(body.max_completion_tokens).toBeUndefined();
      expect(body.temperature).toBe(0.4);
    });

    it('should pass abort signal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });

      const controller = new AbortController();
      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'test' }], {
        signal: controller.signal,
      });

      expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
    });
  });
});
