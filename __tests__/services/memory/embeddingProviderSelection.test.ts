jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn(async (providerId: string) =>
    providerId === 'has-key' ? 'resolved-secret' : '',
  ),
}));

import { resolveEmbeddingProviderPath } from '../../../src/services/memory/embeddingProviderSelection';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../../src/types/provider';

function provider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'has-key',
    name: 'Provider',
    providerFamily: 'openai',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com',
    apiKey: '',
    model: 'gpt-test',
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    memoryConsolidationMode: 'auto',
    consolidationProvider: null,
    activeProviderId: '',
    activeModel: '',
    providers: [],
  } as never);
});

describe('resolveEmbeddingProviderPath', () => {
  it('returns null when no embedding-capable provider is enabled', async () => {
    expect(await resolveEmbeddingProviderPath()).toBeNull();
  });

  it('selects OpenAI first, reusing its chat API key and base URL', async () => {
    useSettingsStore.setState({
      providers: [provider({ id: 'has-key', providerFamily: 'openai', baseUrl: 'https://proxy.example.com' })],
    } as never);

    const path = await resolveEmbeddingProviderPath();
    expect(path).toEqual({
      providerId: 'has-key',
      providerFamily: 'openai',
      config: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        apiKey: 'resolved-secret',
        baseUrl: 'https://proxy.example.com',
      },
    });
  });

  it('selects Gemini when OpenAI is not enabled', async () => {
    useSettingsStore.setState({
      providers: [provider({ id: 'has-key', providerFamily: 'gemini' })],
    } as never);

    const path = await resolveEmbeddingProviderPath();
    expect(path?.providerFamily).toBe('gemini');
    expect(path?.config).toMatchObject({ provider: 'gemini', model: 'text-embedding-004' });
  });

  it('skips Voyage/Mistral when no key resolves, and never selects Anthropic', async () => {
    useSettingsStore.setState({
      providers: [
        provider({ id: 'no-key', providerFamily: 'voyage' }),
        provider({ id: 'no-key', providerFamily: 'mistral' }),
        provider({ id: 'no-key', providerFamily: 'anthropic' }),
      ],
    } as never);

    expect(await resolveEmbeddingProviderPath()).toBeNull();
  });

  it('selects Voyage once its own key resolves', async () => {
    useSettingsStore.setState({
      providers: [provider({ id: 'has-key', providerFamily: 'voyage' })],
    } as never);

    const path = await resolveEmbeddingProviderPath();
    expect(path?.providerFamily).toBe('voyage');
    expect(path?.config).toMatchObject({ provider: 'voyage', model: 'voyage-3-lite' });
  });

  it('selects Mistral once its own key resolves', async () => {
    useSettingsStore.setState({
      providers: [provider({ id: 'has-key', providerFamily: 'mistral' })],
    } as never);

    const path = await resolveEmbeddingProviderPath();
    expect(path?.providerFamily).toBe('mistral');
    expect(path?.config).toMatchObject({ provider: 'mistral', model: 'mistral-embed' });
  });

  it('selects Ollama using its own configured host, keyless', async () => {
    useSettingsStore.setState({
      providers: [
        provider({
          id: 'no-key',
          providerFamily: 'ollama',
          baseUrl: 'http://my-ollama-host:11434',
        }),
      ],
    } as never);

    const path = await resolveEmbeddingProviderPath();
    expect(path).toEqual({
      providerId: 'no-key',
      providerFamily: 'ollama',
      config: {
        provider: 'ollama',
        model: 'nomic-embed-text',
        dimensions: 768,
        baseUrl: 'http://my-ollama-host:11434',
      },
    });
  });

  it('prefers OpenAI over Gemini and Ollama when several are enabled', async () => {
    useSettingsStore.setState({
      providers: [
        provider({ id: 'no-key', providerFamily: 'ollama' }),
        provider({ id: 'has-key', providerFamily: 'gemini' }),
        provider({ id: 'has-key', providerFamily: 'openai' }),
      ],
    } as never);

    const path = await resolveEmbeddingProviderPath();
    expect(path?.providerFamily).toBe('openai');
  });

  it('is gated off by disableLongTermMemory, the same as consolidation', async () => {
    useSettingsStore.setState({
      disableLongTermMemory: true,
      providers: [provider({ id: 'has-key', providerFamily: 'openai' })],
    } as never);

    expect(await resolveEmbeddingProviderPath()).toBeNull();
  });

  it('is gated off when memory-consolidation enrichment mode is off', async () => {
    useSettingsStore.setState({
      memoryConsolidationMode: 'off',
      providers: [provider({ id: 'has-key', providerFamily: 'openai' })],
    } as never);

    expect(await resolveEmbeddingProviderPath()).toBeNull();
  });

  it('never selects a disabled provider entry', async () => {
    useSettingsStore.setState({
      providers: [provider({ id: 'has-key', providerFamily: 'openai', enabled: false })],
    } as never);

    expect(await resolveEmbeddingProviderPath()).toBeNull();
  });
});
