// ---------------------------------------------------------------------------
// Tests — Constants: API
// ---------------------------------------------------------------------------

import {
  buildProviderFromPreset,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_OPENAI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  finalizeProviderConfig,
  isVertexOpenAiCompatibleBaseUrl,
  KNOWN_PROVIDERS,
  normalizeGeminiBaseUrl,
  normalizeGeminiOpenAiBaseUrl,
} from '../../src/constants/api';

describe('API Constants', () => {
  describe('DEFAULT_OPENAI_BASE_URL', () => {
    it('should be a valid OpenAI URL', () => {
      expect(DEFAULT_OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    });
  });

  describe('DEFAULT_GEMINI_OPENAI_BASE_URL', () => {
    it('should be the AI Studio OpenAI-compatible endpoint', () => {
      expect(DEFAULT_GEMINI_OPENAI_BASE_URL).toBe(
        'https://generativelanguage.googleapis.com/v1beta/openai',
      );
    });
  });

  describe('DEFAULT_GEMINI_BASE_URL', () => {
    it('should be the Vertex native Gemini endpoint root', () => {
      expect(DEFAULT_GEMINI_BASE_URL).toBe('https://aiplatform.googleapis.com/v1');
    });
  });

  describe('KNOWN_PROVIDERS', () => {
    it('should contain at least 5 providers', () => {
      expect(KNOWN_PROVIDERS.length).toBeGreaterThanOrEqual(5);
    });

    it('should include OpenAI', () => {
      const openai = KNOWN_PROVIDERS.find((p) => p.name === 'OpenAI');
      expect(openai).toBeDefined();
      expect(openai!.baseUrl).toContain('openai.com');
      expect(openai!.defaultModel).toBeTruthy();
    });

    it('should include Anthropic', () => {
      const anthropic = KNOWN_PROVIDERS.find((p) => p.name === 'Anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic!.baseUrl).toContain('anthropic.com');
    });

    it('should include OpenRouter', () => {
      const openrouter = KNOWN_PROVIDERS.find((p) => p.name === 'OpenRouter');
      expect(openrouter).toBeDefined();
      expect(openrouter!.baseUrl).toContain('openrouter.ai');
    });

    it('should include Gemini', () => {
      const gemini = KNOWN_PROVIDERS.find((p) => p.name === 'Gemini');
      expect(gemini).toBeDefined();
      expect(gemini!.baseUrl).toBe(DEFAULT_GEMINI_BASE_URL);
      expect(gemini!.defaultModel).toBe('gemini-3.1-pro-preview');
    });

    it('should include Ollama', () => {
      const ollama = KNOWN_PROVIDERS.find((p) => p.name.includes('Ollama'));
      expect(ollama).toBeDefined();
      expect(ollama!.baseUrl).toContain('localhost');
    });

    it('every provider should have name and defaultModel, and remote providers should have a baseUrl', () => {
      for (const provider of KNOWN_PROVIDERS) {
        expect(provider.name).toBeTruthy();
        if (provider.kind === 'remote') {
          expect(provider.baseUrl).toBeTruthy();
        } else {
          expect(provider.baseUrl).toBe('');
        }
        expect(provider.defaultModel).toBeTruthy();
      }
    });
  });

  describe('Gemini helpers', () => {
    it('normalizes Google AI Studio host-only URLs', () => {
      expect(normalizeGeminiOpenAiBaseUrl('https://generativelanguage.googleapis.com')).toBe(
        DEFAULT_GEMINI_OPENAI_BASE_URL,
      );
      expect(normalizeGeminiOpenAiBaseUrl('https://generativelanguage.googleapis.com/v1beta')).toBe(
        DEFAULT_GEMINI_OPENAI_BASE_URL,
      );
    });

    it('normalizes Vertex Gemini host-only URLs to the native API root', () => {
      expect(normalizeGeminiBaseUrl('https://aiplatform.googleapis.com')).toBe(
        DEFAULT_GEMINI_BASE_URL,
      );
      expect(
        normalizeGeminiBaseUrl('https://aiplatform.googleapis.com/v1/publishers/google/models'),
      ).toBe(DEFAULT_GEMINI_BASE_URL);
    });

    it('preserves Vertex OpenAI compatibility endpoints', () => {
      const vertexOpenAiBaseUrl =
        'https://aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/endpoints/openapi';

      expect(isVertexOpenAiCompatibleBaseUrl(vertexOpenAiBaseUrl)).toBe(true);
      expect(normalizeGeminiOpenAiBaseUrl(vertexOpenAiBaseUrl)).toBe(vertexOpenAiBaseUrl);
    });

    it('finalizes Vertex Gemini providers with normalized base URL and inferred capabilities', () => {
      const provider = finalizeProviderConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://aiplatform.googleapis.com',
        apiKey: '',
        model: 'gemini-2.5-pro',
        enabled: true,
      });

      expect(provider.baseUrl).toBe(DEFAULT_GEMINI_BASE_URL);
      expect(provider.availableModels).toContain('gemini-2.5-pro');
      expect(provider.modelCapabilities?.['gemini-2.5-pro']).toEqual({
        vision: true,
        tools: true,
        fileInput: true,
      });
    });

    it('keeps legacy AI Studio Gemini providers on the OpenAI-compatible base URL', () => {
      const provider = finalizeProviderConfig({
        id: 'gemini-legacy',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: '',
        model: 'gemini-2.5-pro',
        enabled: true,
      });

      expect(provider.baseUrl).toBe(DEFAULT_GEMINI_OPENAI_BASE_URL);
    });

    it('builds preset providers with Gemini defaults', () => {
      const preset = KNOWN_PROVIDERS.find((provider) => provider.name === 'Gemini');
      expect(preset).toBeDefined();

      const provider = buildProviderFromPreset(preset!, { id: 'gemini-preset' });
      expect(provider).toEqual(
        expect.objectContaining({
          id: 'gemini-preset',
          name: 'Gemini',
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          model: 'gemini-3.1-pro-preview',
        }),
      );
    });
  });
});
