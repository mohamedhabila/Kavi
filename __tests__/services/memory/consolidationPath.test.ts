jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn(async () => ''),
}));

import { resolveConsolidationPath } from '../../../src/services/memory/consolidation/paths';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../../src/types/provider';

const ORIGINAL_E2E_ENV = process.env.RUN_E2E_AGENT_EVAL;

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'active-chat',
    name: 'Active Chat',
    providerFamily: 'gemini',
    protocol: 'gemini-native',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'test-key',
    model: 'gemini-test',
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.RUN_E2E_AGENT_EVAL = undefined;
  useSettingsStore.setState({
    disableLongTermMemory: false,
    memoryConsolidationMode: 'auto',
    consolidationProvider: null,
    activeProviderId: '',
    activeModel: '',
    providers: [],
  } as never);
});

afterEach(() => {
  process.env.RUN_E2E_AGENT_EVAL = ORIGINAL_E2E_ENV;
});

describe('resolveConsolidationPath', () => {
  it('keeps E2E deterministic when no active provider is supplied', async () => {
    process.env.RUN_E2E_AGENT_EVAL = '1';

    const path = await resolveConsolidationPath();

    expect(path.tier).toBe('deterministic');
    expect(path.extractor).toBeNull();
  });

  it('allows live E2E semantic consolidation with an explicit active provider', async () => {
    process.env.RUN_E2E_AGENT_EVAL = '1';
    const provider = makeProvider();

    const path = await resolveConsolidationPath(provider);

    expect(path.tier).toBe('chat');
    expect(path.provider?.id).toBe(provider.id);
    expect(path.model).toBe(provider.model);
    expect(path.extractor).toEqual(expect.any(Function));
  });
});
