import { isDirectAnthropicProvider } from '../../src/engine/orchestratorProviderRuntime';
import type { LlmProviderConfig } from '../../src/types/provider';

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5',
    enabled: true,
    ...overrides,
  };
}

describe('orchestratorProviderRuntime', () => {
  it('honors explicit anthropic provider family metadata without rediscovering it from the URL', () => {
    expect(
      isDirectAnthropicProvider(
        makeProvider({
          name: 'Proxy Provider',
          providerFamily: 'anthropic',
          baseUrl: 'https://proxy.example.com/v1',
        }),
      ),
    ).toBe(true);
  });

  it('does not infer anthropic provider identity from a misleading provider name when metadata disagrees', () => {
    expect(
      isDirectAnthropicProvider(
        makeProvider({
          name: 'Anthropic via proxy',
          providerFamily: 'openai',
          baseUrl: 'https://proxy.example.com/v1',
        }),
      ),
    ).toBe(false);
  });
});
