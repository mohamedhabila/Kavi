jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn(async () => ''),
}));

import {
  extractConsolidationAssistantText,
  resolveConsolidationPath,
} from '../../../src/services/memory/consolidation/paths';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../../src/types/provider';

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
  useSettingsStore.setState({
    disableLongTermMemory: false,
    memoryConsolidationMode: 'auto',
    consolidationProvider: null,
    activeProviderId: '',
    activeModel: '',
    providers: [],
  } as never);
});

describe('resolveConsolidationPath', () => {
  it('uses structural consolidation when no provider path is configured', async () => {
    const path = await resolveConsolidationPath();

    expect(path.tier).toBe('deterministic');
    expect(path.extractor).toBeNull();
  });

  it('uses semantic consolidation with an explicit active provider', async () => {
    const provider = makeProvider();

    const path = await resolveConsolidationPath(provider);

    expect(path.tier).toBe('chat');
    expect(path.provider?.id).toBe(provider.id);
    expect(path.model).toBe(provider.model);
    expect(path.extractor).toEqual(expect.any(Function));
  });

  it('keeps the job-scoped model instead of substituting the current global model', async () => {
    const provider = makeProvider({ model: 'persisted-conversation-model' });
    useSettingsStore.setState({
      memoryConsolidationMode: 'active_provider',
      activeProviderId: provider.id,
      activeModel: 'new-global-model',
      providers: [{ ...provider, model: 'provider-default-model' }],
    } as never);

    const path = await resolveConsolidationPath(provider);

    expect(path.tier).toBe('chat');
    expect(path.model).toBe('persisted-conversation-model');
  });

  it('does not substitute a different global provider for a queued turn', async () => {
    const currentProvider = makeProvider({ id: 'new-global-provider', model: 'new-global-model' });
    useSettingsStore.setState({
      memoryConsolidationMode: 'active_provider',
      activeProviderId: currentProvider.id,
      activeModel: currentProvider.model,
      providers: [currentProvider],
    } as never);

    const path = await resolveConsolidationPath(undefined, {
      requireExplicitChatProvider: true,
    });

    expect(path).toEqual({
      tier: 'deterministic',
      provider: null,
      model: null,
      extractor: null,
    });
  });
});

describe('extractConsolidationAssistantText', () => {
  it('extracts normalized provider text shapes', () => {
    expect(
      extractConsolidationAssistantText({
        choices: [{ message: { content: [{ text: '{"new_' }, { output_text: 'facts":[]}' }] } }],
      }),
    ).toBe('{"new_facts":[]}');
  });

  it.each([
    null,
    {},
    { choices: [] },
    { choices: [{ message: { content: [{ type: 'image' }] } }] },
  ])('throws for unsupported provider response shape %p', (response) => {
    expect(() => extractConsolidationAssistantText(response)).toThrow(
      'Unsupported consolidation provider response shape',
    );
  });
});
