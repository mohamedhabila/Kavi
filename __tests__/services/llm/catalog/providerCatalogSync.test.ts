const mockFetchLlmProviderModels = jest.fn();
jest.mock('../../../../src/services/llm/modelService', () => ({
  fetchLlmProviderModels: (...args: unknown[]) => mockFetchLlmProviderModels(...args),
}));
jest.mock('../../../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn(async () => 'secure-key'),
}));

import {
  needsModelCatalogSync,
  resetProviderModelCatalogSyncForTests,
  startActiveProviderModelCatalogSync,
  syncActiveProviderModelCatalog,
} from '../../../../src/services/llm/catalog/providerCatalogSync';
import { useSettingsStore } from '../../../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../../../src/types/provider';

const MODEL = 'z-ai/glm-5.3-flash';

function openRouterProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    providerFamily: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: MODEL,
    enabled: true,
    ...overrides,
  };
}

const DISCOVERED = {
  models: [MODEL, 'openai/gpt-5.5'],
  capabilities: {
    [MODEL]: {
      vision: true,
      tools: true,
      fileInput: false,
      reasoning: { mandatory: true, supportedEfforts: ['max', 'high', 'low'] },
    },
  },
  contextWindows: { [MODEL]: 1_048_576 },
};

function installActiveProvider(provider: LlmProviderConfig): void {
  useSettingsStore.setState({
    providers: [provider],
    activeProviderId: provider.id,
    activeModel: provider.model,
  } as never);
}

function storedProvider(): LlmProviderConfig | undefined {
  return useSettingsStore.getState().providers.find((entry) => entry.id === 'openrouter');
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  resetProviderModelCatalogSyncForTests();
});

describe('needsModelCatalogSync', () => {
  it('is needed while nothing the provider declares about the model is recorded', () => {
    expect(needsModelCatalogSync(openRouterProvider(), MODEL)).toBe(true);
  });

  it('is not needed once reasoning rules or a context window are recorded', () => {
    expect(
      needsModelCatalogSync(
        openRouterProvider({ modelCapabilities: DISCOVERED.capabilities }),
        MODEL,
      ),
    ).toBe(false);
    expect(
      needsModelCatalogSync(openRouterProvider({ modelContextWindows: { [MODEL]: 8192 } }), MODEL),
    ).toBe(false);
  });

  it('is never needed for an on-device provider', () => {
    expect(
      needsModelCatalogSync(
        openRouterProvider({ kind: 'local', local: { runtime: 'litert' } as never }),
        MODEL,
      ),
    ).toBe(false);
  });
});

describe('syncActiveProviderModelCatalog', () => {
  it('records the discovered declarations on the stored provider without its secret key', async () => {
    installActiveProvider(openRouterProvider());
    mockFetchLlmProviderModels.mockResolvedValue(DISCOVERED);

    await syncActiveProviderModelCatalog();

    expect(mockFetchLlmProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ provider: expect.objectContaining({ apiKey: 'secure-key' }) }),
    );
    const stored = storedProvider();
    expect(stored?.modelCapabilities?.[MODEL]?.reasoning).toEqual({
      mandatory: true,
      supportedEfforts: ['max', 'high', 'low'],
    });
    expect(stored?.modelContextWindows?.[MODEL]).toBe(1_048_576);
    expect(stored?.apiKey).toBe('');
  });

  it('attempts each provider and model once per launch', async () => {
    installActiveProvider(openRouterProvider());
    mockFetchLlmProviderModels.mockResolvedValue({
      models: [],
      capabilities: {},
      contextWindows: {},
    });

    await syncActiveProviderModelCatalog();
    await syncActiveProviderModelCatalog();

    expect(mockFetchLlmProviderModels).toHaveBeenCalledTimes(1);
  });

  it('leaves the provider unchanged when discovery fails', async () => {
    const provider = openRouterProvider();
    installActiveProvider(provider);
    mockFetchLlmProviderModels.mockRejectedValue(new Error('offline'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(syncActiveProviderModelCatalog()).resolves.toBeUndefined();

    expect(storedProvider()?.modelCapabilities?.[MODEL]?.reasoning).toBeUndefined();
    warn.mockRestore();
  });

  it('skips a provider whose active model is already described', async () => {
    installActiveProvider(openRouterProvider({ modelCapabilities: DISCOVERED.capabilities }));

    await syncActiveProviderModelCatalog();

    expect(mockFetchLlmProviderModels).not.toHaveBeenCalled();
  });
});

describe('startActiveProviderModelCatalogSync', () => {
  it('syncs again when the user switches to another model', async () => {
    installActiveProvider(openRouterProvider());
    mockFetchLlmProviderModels.mockResolvedValue({
      models: [],
      capabilities: {},
      contextWindows: {},
    });

    const stop = startActiveProviderModelCatalogSync();
    await flush();
    useSettingsStore.setState({ activeModel: 'openai/gpt-5.5' } as never);
    await flush();
    stop();

    expect(mockFetchLlmProviderModels).toHaveBeenCalledTimes(2);
  });
});
