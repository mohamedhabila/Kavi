import { sanitizeWebSearchProvider } from '../../src/store/settingsStoreNormalization';

describe('sanitizeWebSearchProvider', () => {
  it('keeps every supported provider pin, including openrouter', () => {
    for (const provider of [
      'auto',
      'brave',
      'gemini',
      'perplexity',
      'grok',
      'kimi',
      'anthropic',
      'openai',
      'openrouter',
    ] as const) {
      expect(sanitizeWebSearchProvider(provider)).toBe(provider);
    }
  });

  it('falls back to auto for an unsupported or malformed value', () => {
    expect(sanitizeWebSearchProvider('not-a-provider')).toBe('auto');
    expect(sanitizeWebSearchProvider(undefined)).toBe('auto');
    expect(sanitizeWebSearchProvider(null)).toBe('auto');
    expect(sanitizeWebSearchProvider(42)).toBe('auto');
  });
});
