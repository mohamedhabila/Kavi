// ---------------------------------------------------------------------------
// Tests — LLM Service: sendMessage Anthropic request shape per model generation
// ---------------------------------------------------------------------------
//
// Covers the Claude 5.x / 4.x model-layer refresh: thinking shape, sampling
// param stripping, effort validation, and forced tool_choice conversion, per
// Anthropic's documented request-shape rules for each model family/generation.

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

function mockOkResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
  });
}

function requestBody() {
  return JSON.parse(mockFetch.mock.calls[0][1].body);
}

const READ_FILE_TOOL = {
  name: 'read_file',
  description: 'Read a file.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

describe('LlmService', () => {
  describe('sendMessage Anthropic model-generation request shapes', () => {
    it('Fable 5.1: strips thinking and temperature, converts forced tool_choice to auto with a system instruction', async () => {
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-fable-5-1',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Use the tool.' }], {
        thinking: { type: 'enabled', budget_tokens: 5000 },
        temperature: 0.7,
        maxTokens: 8000,
        output_config: { effort: 'xhigh' },
        tools: [READ_FILE_TOOL],
        toolChoice: 'required',
      });

      const body = requestBody();
      expect(body.thinking).toBeUndefined();
      expect(body.temperature).toBeUndefined();
      expect(body.output_config).toEqual({ effort: 'xhigh' });
      expect(body.tool_choice).toEqual({ type: 'auto' });
      expect(typeof body.system).toBe('string');
      expect(body.system).toContain('read_file');
    });

    it('Fable 5 (not 5.1): strips thinking/temperature but leaves a forced tool_choice untouched', async () => {
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-fable-5',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Use the tool.' }], {
        thinking: { type: 'enabled', budget_tokens: 5000 },
        temperature: 0.7,
        maxTokens: 8000,
        tools: [READ_FILE_TOOL],
        toolChoice: 'required',
      });

      const body = requestBody();
      expect(body.thinking).toBeUndefined();
      expect(body.temperature).toBeUndefined();
      // Fable 5 (unlike 5.1) does not reject a forced tool_choice.
      expect(body.tool_choice).toEqual({ type: 'any' });
    });

    it('Opus 5: rewrites legacy enabled+budget_tokens thinking to adaptive and strips sampling params', async () => {
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-opus-5',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello.' }], {
        thinking: { type: 'enabled', budget_tokens: 5000 },
        temperature: 0.7,
        maxTokens: 8000,
        output_config: { effort: 'xhigh' },
      });

      const body = requestBody();
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.temperature).toBeUndefined();
      expect(body.output_config).toEqual({ effort: 'xhigh' });
    });

    it('Opus 4.8: same adaptive-only shape as Opus 5', async () => {
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-opus-4-8',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello.' }], {
        thinking: { type: 'enabled', budget_tokens: 5000 },
        temperature: 0.9,
        maxTokens: 8000,
      });

      const body = requestBody();
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.temperature).toBeUndefined();
    });

    it('Opus 5: rejects sampling params even with no explicit thinking param, and effort still applies', async () => {
      // "adaptive thinking by default when thinking omitted" — the model still needs no
      // sampling params, and output_config.effort is still a valid independent lever.
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-opus-5',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello.' }], {
        temperature: 0.7,
        maxTokens: 8000,
        output_config: { effort: 'high' },
      });

      const body = requestBody();
      expect(body.thinking).toBeUndefined();
      expect(body.temperature).toBeUndefined();
      expect(body.output_config).toEqual({ effort: 'high' });
    });

    it('Sonnet 4.6: keeps the legacy enabled+budget_tokens shape and rejects xhigh effort', async () => {
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello.' }], {
        thinking: { type: 'enabled', budget_tokens: 5000 },
        maxTokens: 8000,
        output_config: { effort: 'xhigh' },
      });

      const body = requestBody();
      expect(body.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 5000,
        display: 'summarized',
      });
      // xhigh isn't in 4.6's supported range, so the whole output_config drops (no format either).
      expect(body.output_config).toBeUndefined();
    });

    it('Sonnet 4.6: without an explicit thinking param, sampling is not stripped (unlike Opus 5+)', async () => {
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello.' }], {
        temperature: 0.6,
        maxTokens: 8000,
        output_config: { effort: 'high' },
      });

      const body = requestBody();
      // 4.6 still allows sampling params — no clamp-to-1 (the old behavior), no stripping.
      expect(body.temperature).toBe(0.6);
      expect(body.output_config).toEqual({ effort: 'high' });
    });

    it('Haiku 4.5: keeps the legacy thinking shape and drops unsupported effort entirely', async () => {
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-haiku-4-5',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello.' }], {
        thinking: { type: 'enabled', budget_tokens: 3000 },
        maxTokens: 8000,
        output_config: { effort: 'low' },
      });

      const body = requestBody();
      expect(body.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 3000,
        display: 'summarized',
      });
      expect(body.output_config).toBeUndefined();
    });

    it('Haiku 4.5: without an explicit thinking param, sampling is not stripped', async () => {
      mockOkResponse();
      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-haiku-4-5',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Hello.' }], {
        temperature: 0.5,
        maxTokens: 8000,
      });

      const body = requestBody();
      expect(body.temperature).toBe(0.5);
    });
  });
});
