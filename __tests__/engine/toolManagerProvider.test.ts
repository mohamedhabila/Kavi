import { resolveToolProviderFamily } from '../../src/engine/tools/toolManagerProvider';

describe('toolManagerProvider', () => {
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

    it('resolves the family from the provider name, transport URL or hosted model', () => {
      expect(resolveToolProviderFamily('openai')).toBe('openai');
      expect(resolveToolProviderFamily('anything', 'https://api.openai.com/v1')).toBe('openai');
      expect(resolveToolProviderFamily('mine', 'https://api.anthropic.com')).toBe('anthropic');
      expect(
        resolveToolProviderFamily(
          'openrouter',
          'https://openrouter.ai/api/v1',
          'anthropic/claude-3.7-sonnet',
        ),
      ).toBe('anthropic');
      expect(resolveToolProviderFamily('unknown-provider')).toBe('default');
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
