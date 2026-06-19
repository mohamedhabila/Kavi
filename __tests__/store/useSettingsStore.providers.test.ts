import {
  makeMcpServer,
  makeProvider,
  resetSettingsStore,
} from '../helpers/settingsStoreFixtures';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../src/types/provider';
import { getLocalLlmCatalogEntry } from '../../src/services/localLlm/catalog';

beforeEach(() => {
  resetSettingsStore();
});

describe('useSettingsStore provider settings', () => {
  it('adds a provider', () => {
    const provider = makeProvider();
    useSettingsStore.getState().addProvider(provider);

    expect(useSettingsStore.getState().providers).toHaveLength(1);
    expect(useSettingsStore.getState().providers[0].name).toBe('Test Provider');
  });

  it('normalizes on-device providers when adding them', () => {
    useSettingsStore.getState().addProvider({
      id: 'local-provider',
      kind: 'on-device',
      name: '   ',
      baseUrl: 'https://should-be-cleared.example.com',
      apiKey: 'secret',
      model: 'not-a-real-model',
      enabled: true,
      local: {
        runtime: 'litert-lm',
      },
    } as LlmProviderConfig);

    const provider = useSettingsStore.getState().providers[0];
    const catalogEntry = getLocalLlmCatalogEntry(provider.model);
    expect(provider.kind).toBe('on-device');
    expect(provider.baseUrl).toBe('');
    expect(provider.apiKey).toBe('');
    expect(provider.local?.runtime).toBe(catalogEntry?.runtime);
    expect(provider.availableModels).toContain(provider.model);
    expect(provider.modelCapabilities?.[provider.model]).toEqual(
      expect.objectContaining({
        tools: false,
      }),
    );
  });

  it('sets the first added provider as active', () => {
    useSettingsStore.getState().addProvider(makeProvider());

    expect(useSettingsStore.getState().activeProviderId).toBe('test-provider');
  });

  it('does not overwrite the active provider when adding another', () => {
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p1' }));
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p2' }));

    expect(useSettingsStore.getState().activeProviderId).toBe('p1');
  });

  it('updates a provider', () => {
    useSettingsStore.getState().addProvider(makeProvider());
    useSettingsStore.getState().updateProvider(makeProvider({ name: 'Updated' }));

    expect(useSettingsStore.getState().providers[0].name).toBe('Updated');
  });

  it('clears lastUsedModel when disabling provider', () => {
    useSettingsStore.getState().addProvider(makeProvider());
    useSettingsStore.getState().setLastUsedModel('test-provider', 'test-model');
    expect(useSettingsStore.getState().lastUsedModel).not.toBeNull();

    useSettingsStore.getState().updateProvider(makeProvider({ enabled: false }));
    expect(useSettingsStore.getState().lastUsedModel).toBeNull();
  });

  it('falls back to the next enabled provider when disabling the active provider', () => {
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p1', model: 'gpt-5.4' }));
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p2', model: 'gpt-5-mini' }));

    useSettingsStore
      .getState()
      .updateProvider(makeProvider({ id: 'p1', model: 'gpt-5.4', enabled: false }));

    const state = useSettingsStore.getState();
    expect(state.activeProviderId).toBe('p2');
    expect(state.activeModel).toBe('gpt-5-mini');
  });

  it('refreshes the active model when the active provider model changes', () => {
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p1', model: 'gpt-5.4' }));
    useSettingsStore.getState().setActiveProviderAndModel('p1', 'gpt-5.4');

    useSettingsStore.getState().updateProvider(makeProvider({ id: 'p1', model: 'gpt-5.5' }));

    expect(useSettingsStore.getState().activeModel).toBe('gpt-5.5');
  });

  it('removes a provider', () => {
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p1' }));
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p2' }));

    useSettingsStore.getState().removeProvider('p1');
    expect(useSettingsStore.getState().providers).toHaveLength(1);
    expect(useSettingsStore.getState().providers[0].id).toBe('p2');
  });

  it('updates active provider when removing the active one', () => {
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p1' }));
    useSettingsStore.getState().addProvider(makeProvider({ id: 'p2' }));

    useSettingsStore.getState().removeProvider('p1');
    expect(useSettingsStore.getState().activeProviderId).toBe('p2');
  });

  it('sets active provider to null when removing the last provider', () => {
    useSettingsStore.getState().addProvider(makeProvider());
    useSettingsStore.getState().removeProvider('test-provider');

    expect(useSettingsStore.getState().activeProviderId).toBeNull();
  });

  it('toggles model visibility', () => {
    useSettingsStore.getState().addProvider(makeProvider());

    useSettingsStore.getState().toggleModelVisibility('test-provider', 'model-a');
    expect(useSettingsStore.getState().providers[0].hiddenModels).toContain('model-a');

    useSettingsStore.getState().toggleModelVisibility('test-provider', 'model-a');
    expect(useSettingsStore.getState().providers[0].hiddenModels).not.toContain('model-a');
  });
});

describe('useSettingsStore MCP settings', () => {
  it('adds an MCP server', () => {
    useSettingsStore.getState().addMcpServer(makeMcpServer());
    expect(useSettingsStore.getState().mcpServers).toHaveLength(1);
  });

  it('updates an MCP server', () => {
    useSettingsStore.getState().addMcpServer(makeMcpServer());
    useSettingsStore.getState().updateMcpServer(makeMcpServer({ name: 'Updated MCP' }));
    expect(useSettingsStore.getState().mcpServers[0].name).toBe('Updated MCP');
  });

  it('removes an MCP server', () => {
    useSettingsStore.getState().addMcpServer(makeMcpServer());
    useSettingsStore.getState().removeMcpServer('test-mcp');
    expect(useSettingsStore.getState().mcpServers).toHaveLength(0);
  });
});

describe('useSettingsStore preference settings', () => {
  it('sets theme', () => {
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');

    useSettingsStore.getState().setTheme('system');
    expect(useSettingsStore.getState().theme).toBe('system');
  });

  it('updates system prompt', () => {
    useSettingsStore.getState().setSystemPrompt('Custom prompt');
    expect(useSettingsStore.getState().systemPrompt).toBe('Custom prompt');
  });

  it('defaults thinking level to medium', () => {
    expect(useSettingsStore.getState().thinkingLevel).toBe('medium');
  });

  it('updates thinking level', () => {
    useSettingsStore.getState().setThinkingLevel('high');
    expect(useSettingsStore.getState().thinkingLevel).toBe('high');
  });

  it('tracks last used model', () => {
    useSettingsStore.getState().setLastUsedModel('p1', 'gpt-5.4');
    expect(useSettingsStore.getState().lastUsedModel).toEqual({
      providerId: 'p1',
      model: 'gpt-5.4',
    });
  });

  it('clears last used model when provider is removed', () => {
    useSettingsStore.getState().addProvider(makeProvider());
    useSettingsStore.getState().setLastUsedModel('test-provider', 'gpt-5.4');
    useSettingsStore.getState().removeProvider('test-provider');
    expect(useSettingsStore.getState().lastUsedModel).toBeNull();
  });

  it('preserves last used model when clearing active provider selection', () => {
    useSettingsStore.getState().setLastUsedModel('p1', 'gpt-5.4');
    useSettingsStore.getState().setActiveProviderAndModel(null, null);

    expect(useSettingsStore.getState().lastUsedModel).toEqual({
      providerId: 'p1',
      model: 'gpt-5.4',
    });
  });

  it('defaults locale to English and allows changing it', () => {
    expect(useSettingsStore.getState().locale).toBe('en');

    useSettingsStore.getState().setLocale('fr');
    expect(useSettingsStore.getState().locale).toBe('fr');
  });

  it('defaults web search provider to auto and allows a preferred provider', () => {
    expect(useSettingsStore.getState().webSearchProvider).toBe('auto');

    useSettingsStore.getState().setWebSearchProvider('brave');
    expect(useSettingsStore.getState().webSearchProvider).toBe('brave');
  });

  it('toggles link understanding', () => {
    expect(useSettingsStore.getState().linkUnderstandingEnabled).toBe(true);

    useSettingsStore.getState().setLinkUnderstandingEnabled(false);
    expect(useSettingsStore.getState().linkUnderstandingEnabled).toBe(false);

    useSettingsStore.getState().setLinkUnderstandingEnabled(true);
    expect(useSettingsStore.getState().linkUnderstandingEnabled).toBe(true);
  });

  it('toggles media understanding', () => {
    expect(useSettingsStore.getState().mediaUnderstandingEnabled).toBe(true);

    useSettingsStore.getState().setMediaUnderstandingEnabled(false);
    expect(useSettingsStore.getState().mediaUnderstandingEnabled).toBe(false);
  });

  it('sets and clamps max links', () => {
    expect(useSettingsStore.getState().maxLinks).toBe(3);

    useSettingsStore.getState().setMaxLinks(5);
    expect(useSettingsStore.getState().maxLinks).toBe(5);

    useSettingsStore.getState().setMaxLinks(0);
    expect(useSettingsStore.getState().maxLinks).toBe(1);

    useSettingsStore.getState().setMaxLinks(-5);
    expect(useSettingsStore.getState().maxLinks).toBe(1);

    useSettingsStore.getState().setMaxLinks(15);
    expect(useSettingsStore.getState().maxLinks).toBe(10);
  });

  it('updates the default conversation mode', () => {
    useSettingsStore.getState().setDefaultConversationMode('chitchat');
    expect(useSettingsStore.getState().defaultConversationMode).toBe('chitchat');
  });

  it('sets memory consolidation provider and mode preferences', () => {
    useSettingsStore.getState().setConsolidationProvider(' provider-1 ');
    expect(useSettingsStore.getState().memoryConsolidationMode).toBe('specific');
    expect(useSettingsStore.getState().consolidationProvider).toBe('provider-1');

    useSettingsStore.getState().setConsolidationProvider(' ');
    expect(useSettingsStore.getState().memoryConsolidationMode).toBe('auto');
    expect(useSettingsStore.getState().consolidationProvider).toBeNull();

    useSettingsStore.getState().setMemoryConsolidationMode('specific', ' provider-2 ');
    expect(useSettingsStore.getState().memoryConsolidationMode).toBe('specific');
    expect(useSettingsStore.getState().consolidationProvider).toBe('provider-2');

    useSettingsStore.getState().setMemoryConsolidationMode('local', 'provider-2');
    expect(useSettingsStore.getState().memoryConsolidationMode).toBe('local');
    expect(useSettingsStore.getState().consolidationProvider).toBeNull();

    useSettingsStore.getState().setMemoryConsolidationMode('unknown' as any, 'provider-3');
    expect(useSettingsStore.getState().memoryConsolidationMode).toBe('auto');
    expect(useSettingsStore.getState().consolidationProvider).toBeNull();
  });

  it('sets compaction preferences and long-term memory toggle', () => {
    useSettingsStore.getState().setCompactionProvider(' provider-1 ');
    expect(useSettingsStore.getState().compactionProvider).toBe('provider-1');

    useSettingsStore.getState().setCompactionProvider('');
    expect(useSettingsStore.getState().compactionProvider).toBeNull();

    useSettingsStore.getState().setCompactionModel(' model-a ');
    expect(useSettingsStore.getState().compactionModel).toBe('model-a');

    useSettingsStore.getState().setCompactionModel(' ');
    expect(useSettingsStore.getState().compactionModel).toBeNull();

    useSettingsStore.getState().setDisableLongTermMemory(1 as any);
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(true);

    useSettingsStore.getState().setDisableLongTermMemory(0 as any);
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(false);
  });

  it('normalizes the legacy direct conversation mode alias when migrating', async () => {
    const persistOptions = (useSettingsStore as any).persist.getOptions();
    const migrated = await persistOptions.migrate({ defaultConversationMode: 'direct' }, 8);
    expect(migrated.defaultConversationMode).toBe('chitchat');
  });
});
