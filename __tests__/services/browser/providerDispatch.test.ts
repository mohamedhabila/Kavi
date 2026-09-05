import {
  hasLlmKeyBackedSearchProvider,
  resolveSearchProvider,
} from '../../../src/services/browser/core/providerDispatch';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const mockGetSecure = jest.fn();
const mockGetProviderApiKey = jest.fn();
jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
  getProviderApiKey: (...args: any[]) => mockGetProviderApiKey(...args),
}));

function neverResolverSet() {
  return {
    resolveGeminiApiKey: async () => undefined,
    resolveAnthropicApiKey: async () => undefined,
    resolveOpenAIApiKey: async () => undefined,
    resolveOpenRouterApiKey: async () => undefined,
  };
}

beforeEach(() => {
  mockGetSecure.mockReset();
  mockGetProviderApiKey.mockReset();
  mockGetSecure.mockResolvedValue(null);
  mockGetProviderApiKey.mockResolvedValue(null);
  useSettingsStore.setState({
    activeProviderId: null,
    activeModel: null,
    providers: [],
    webSearchProvider: 'auto',
  } as any);
});

describe('resolveSearchProvider selection order', () => {
  it('prefers a dedicated key over any LLM-key fallback', async () => {
    mockGetSecure.mockImplementation((key: string) =>
      key === 'BRAVE_API_KEY' ? Promise.resolve('brave-key') : Promise.resolve(null),
    );

    const resolved = await resolveSearchProvider({
      resolveGeminiApiKey: async () => 'gemini-llm-key',
      resolveAnthropicApiKey: async () => 'anthropic-llm-key',
      resolveOpenAIApiKey: async () => 'openai-llm-key',
      resolveOpenRouterApiKey: async () => 'openrouter-llm-key',
    });

    expect(resolved).toEqual({ provider: 'brave', apiKey: 'brave-key' });
  });

  it('falls back to Gemini via the LLM key before Anthropic, OpenAI, or OpenRouter', async () => {
    const resolved = await resolveSearchProvider({
      resolveGeminiApiKey: async () => 'gemini-llm-key',
      resolveAnthropicApiKey: async () => 'anthropic-llm-key',
      resolveOpenAIApiKey: async () => 'openai-llm-key',
      resolveOpenRouterApiKey: async () => 'openrouter-llm-key',
    });

    expect(resolved).toEqual({ provider: 'gemini', apiKey: 'gemini-llm-key' });
  });

  it('falls back to Anthropic via the LLM key once Gemini has none', async () => {
    const resolved = await resolveSearchProvider({
      ...neverResolverSet(),
      resolveAnthropicApiKey: async () => 'anthropic-llm-key',
      resolveOpenAIApiKey: async () => 'openai-llm-key',
      resolveOpenRouterApiKey: async () => 'openrouter-llm-key',
    });

    expect(resolved).toEqual({ provider: 'anthropic', apiKey: 'anthropic-llm-key' });
  });

  it('falls back to OpenAI via the LLM key once Gemini and Anthropic have none', async () => {
    const resolved = await resolveSearchProvider({
      ...neverResolverSet(),
      resolveOpenAIApiKey: async () => 'openai-llm-key',
      resolveOpenRouterApiKey: async () => 'openrouter-llm-key',
    });

    expect(resolved).toEqual({ provider: 'openai', apiKey: 'openai-llm-key' });
  });

  it('falls back to OpenRouter via the LLM key only once Gemini, Anthropic, and OpenAI have none', async () => {
    const resolved = await resolveSearchProvider({
      ...neverResolverSet(),
      resolveOpenRouterApiKey: async () => 'openrouter-llm-key',
    });

    expect(resolved).toEqual({ provider: 'openrouter', apiKey: 'openrouter-llm-key' });
  });

  it('resolves to null when no dedicated key or LLM provider key is available', async () => {
    const resolved = await resolveSearchProvider(neverResolverSet());
    expect(resolved).toBeNull();
  });

  it('routes an explicit "anthropic" pin through resolveAnthropicApiKey, bypassing the dedicated-key map', async () => {
    useSettingsStore.setState({ webSearchProvider: 'anthropic' } as any);

    const resolved = await resolveSearchProvider({
      resolveGeminiApiKey: async () => 'gemini-llm-key',
      resolveAnthropicApiKey: async () => 'anthropic-llm-key',
      resolveOpenAIApiKey: async () => 'openai-llm-key',
      resolveOpenRouterApiKey: async () => 'openrouter-llm-key',
    });

    expect(resolved).toEqual({ provider: 'anthropic', apiKey: 'anthropic-llm-key' });
  });

  it('routes an explicit "openai" pin through resolveOpenAIApiKey, bypassing the dedicated-key map', async () => {
    useSettingsStore.setState({ webSearchProvider: 'openai' } as any);

    const resolved = await resolveSearchProvider({
      resolveGeminiApiKey: async () => 'gemini-llm-key',
      resolveAnthropicApiKey: async () => 'anthropic-llm-key',
      resolveOpenAIApiKey: async () => 'openai-llm-key',
      resolveOpenRouterApiKey: async () => 'openrouter-llm-key',
    });

    expect(resolved).toEqual({ provider: 'openai', apiKey: 'openai-llm-key' });
  });

  it('routes an explicit "openrouter" pin through resolveOpenRouterApiKey, bypassing the dedicated-key map', async () => {
    useSettingsStore.setState({ webSearchProvider: 'openrouter' } as any);

    const resolved = await resolveSearchProvider({
      resolveGeminiApiKey: async () => 'gemini-llm-key',
      resolveAnthropicApiKey: async () => 'anthropic-llm-key',
      resolveOpenAIApiKey: async () => 'openai-llm-key',
      resolveOpenRouterApiKey: async () => 'openrouter-llm-key',
    });

    expect(resolved).toEqual({ provider: 'openrouter', apiKey: 'openrouter-llm-key' });
  });

  it('falls through to auto-detection when the explicitly pinned provider has no key', async () => {
    useSettingsStore.setState({ webSearchProvider: 'anthropic' } as any);
    mockGetSecure.mockImplementation((key: string) =>
      key === 'KIMI_API_KEY' ? Promise.resolve('kimi-key') : Promise.resolve(null),
    );

    const resolved = await resolveSearchProvider({
      ...neverResolverSet(),
      resolveAnthropicApiKey: async () => undefined,
    });

    expect(resolved).toEqual({ provider: 'kimi', apiKey: 'kimi-key' });
  });
});

describe('hasLlmKeyBackedSearchProvider', () => {
  it('is false when no enabled provider belongs to a search-capable LLM family', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          name: 'Custom',
          enabled: true,
          providerFamily: 'custom',
          baseUrl: 'https://example.com',
          apiKey: 'x',
          model: 'm',
        },
      ],
    } as any);

    await expect(hasLlmKeyBackedSearchProvider()).resolves.toBe(false);
  });

  it('is true when an enabled OpenRouter provider has a resolvable key', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          name: 'OpenRouter',
          enabled: true,
          providerFamily: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-test',
          model: 'openai/gpt-5.4',
        },
      ],
    } as any);

    await expect(hasLlmKeyBackedSearchProvider()).resolves.toBe(true);
  });

  it('is true when an enabled Anthropic provider has a resolvable key', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          name: 'Anthropic',
          enabled: true,
          providerFamily: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'sk-ant-test',
          model: 'claude-opus-5',
        },
      ],
    } as any);

    await expect(hasLlmKeyBackedSearchProvider()).resolves.toBe(true);
  });

  it('is true when an enabled OpenAI provider only has a secure-storage-backed key', async () => {
    mockGetProviderApiKey.mockImplementation((providerId: string) =>
      providerId === 'p1' ? Promise.resolve('sk-secure') : Promise.resolve(null),
    );
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          name: 'OpenAI',
          enabled: true,
          providerFamily: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-5.4',
        },
      ],
    } as any);

    await expect(hasLlmKeyBackedSearchProvider()).resolves.toBe(true);
  });

  it('is false when the only matching provider is disabled', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          name: 'OpenAI',
          enabled: false,
          providerFamily: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-oa',
          model: 'gpt-5.4',
        },
      ],
    } as any);

    await expect(hasLlmKeyBackedSearchProvider()).resolves.toBe(false);
  });

  it('is false when the matching provider has no key anywhere', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          name: 'OpenAI',
          enabled: true,
          providerFamily: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-5.4',
        },
      ],
    } as any);

    await expect(hasLlmKeyBackedSearchProvider()).resolves.toBe(false);
  });
});
