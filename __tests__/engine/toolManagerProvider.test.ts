import {
  getProviderToolLimit,
  PROVIDER_TOOL_LIMITS,
  resolveToolProviderFamily,
} from '../../src/engine/tools/toolManagerProvider';

describe('toolManagerProvider', () => {
  describe('getProviderToolLimit', () => {
    it('honors explicit provider family metadata without rediscovering provider identity from names or URLs', () => {
      expect(
        getProviderToolLimit(
          'totally-custom-name',
          'https://proxy.example.com/v1',
          'unused-model',
          'remote',
          'gemini',
        ),
      ).toBe(PROVIDER_TOOL_LIMITS.gemini);
    });

    it('returns 128 for OpenAI', () => {
      expect(getProviderToolLimit('openai')).toBe(128);
      expect(getProviderToolLimit('anything', 'https://api.openai.com/v1')).toBe(128);
    });

    it('returns Gemini limits for Gemini transports', () => {
      expect(getProviderToolLimit('gemini')).toBe(PROVIDER_TOOL_LIMITS.gemini);
      expect(
        getProviderToolLimit('anything', 'https://generativelanguage.googleapis.com/v1beta/openai'),
      ).toBe(PROVIDER_TOOL_LIMITS.gemini);
    });

    it('returns Anthropic limits for Anthropic transports', () => {
      expect(getProviderToolLimit('anthropic')).toBe(64);
      expect(getProviderToolLimit('mine', 'https://api.anthropic.com')).toBe(64);
    });

    it('returns on-device limits only from explicit runtime metadata', () => {
      expect(getProviderToolLimit('Anything', '', 'gemma-4-E2B-it', 'on-device')).toBe(
        PROVIDER_TOOL_LIMITS['on-device'],
      );
    });

    it('uses model-family fallback for OpenRouter-hosted models', () => {
      expect(
        getProviderToolLimit('openrouter', 'https://openrouter.ai/api/v1', 'google/gemini-2.5-pro'),
      ).toBe(PROVIDER_TOOL_LIMITS.gemini);
      expect(
        getProviderToolLimit(
          'openrouter',
          'https://openrouter.ai/api/v1',
          'anthropic/claude-3.7-sonnet',
        ),
      ).toBe(PROVIDER_TOOL_LIMITS.anthropic);
    });

    it('returns default limits for unknown providers', () => {
      expect(getProviderToolLimit('unknown-provider')).toBe(128);
    });
  });

  describe('resolveToolProviderFamily', () => {
    it('honors explicit provider family metadata without rediscovering provider identity from names or URLs', () => {
      expect(
        resolveToolProviderFamily(
          'misleading-openai-name',
          'https://proxy.example.com/v1',
          'irrelevant-model',
          'remote',
          'gemini',
        ),
      ).toBe('gemini');
    });

    it('classifies OpenRouter Gemini models as Gemini', () => {
      expect(
        resolveToolProviderFamily(
          'openrouter',
          'https://openrouter.ai/api/v1',
          'google/gemini-2.5-pro',
        ),
      ).toBe('gemini');
    });

    it('classifies Anthropic models by model name when transport is ambiguous', () => {
      expect(
        resolveToolProviderFamily('custom', 'https://proxy.example.com/v1', 'claude-3-7-sonnet'),
      ).toBe('anthropic');
    });

    it('classifies on-device providers separately only from explicit runtime metadata', () => {
      expect(resolveToolProviderFamily('Anything', '', 'gemma-4-E2B-it', 'on-device')).toBe(
        'on-device',
      );
    });

    it('uses the centralized provider-family fallback when explicit metadata is absent', () => {
      expect(
        resolveToolProviderFamily(
          'custom-voyage-provider',
          'https://api.voyageai.com/v1',
          'voyage-3-large',
        ),
      ).toBe('default');
    });
  });
});
