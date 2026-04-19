// ---------------------------------------------------------------------------
// Tests — Settings Store
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../src/store/useSettingsStore';
import {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  LlmProviderConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../src/types';
import { getLocalLlmCatalogEntry } from '../../src/services/localLlm/catalog';

const makeProvider = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'test-provider',
  name: 'Test Provider',
  baseUrl: 'https://api.test.com/v1',
  apiKey: '',
  model: 'test-model',
  enabled: true,
  ...overrides,
});

const makeMcpServer = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'test-mcp',
  name: 'Test MCP',
  url: 'https://mcp.test.com',
  enabled: true,
  tools: [],
  allowedTools: [],
  ...overrides,
});

const makeSshTarget = (overrides: Partial<SshTargetConfig> = {}): SshTargetConfig => ({
  id: 'ssh-1',
  name: 'Build box',
  host: 'ssh.example.com',
  port: 22,
  username: 'developer',
  enabled: true,
  ...overrides,
});

const makeWorkspaceTarget = (
  overrides: Partial<WorkspaceTargetConfig> = {},
): WorkspaceTargetConfig => ({
  id: 'workspace-1',
  name: 'Main repo',
  rootPath: '/Users/username/project',
  configRoots: ['/Users/username/.config'],
  enabled: true,
  ...overrides,
});

const makeBrowserProvider = (
  overrides: Partial<BrowserProviderConfig> = {},
): BrowserProviderConfig => ({
  id: 'browser-1',
  name: 'Browserbase',
  provider: 'browserbase',
  baseUrl: 'https://api.browserbase.com',
  authMode: 'api-key-header',
  projectId: 'bb_project_123',
  enabled: true,
  ...overrides,
});

const makeExpoAccount = (overrides: Partial<ExpoAccountConfig> = {}): ExpoAccountConfig => ({
  id: 'expo-account-1',
  name: 'Expo Production',
  owner: 'kavi',
  accountType: 'personal',
  enabled: true,
  ...overrides,
});

const makeExpoProject = (overrides: Partial<ExpoProjectConfig> = {}): ExpoProjectConfig => ({
  id: 'expo-project-1',
  name: 'Kavi Mobile',
  accountId: 'expo-account-1',
  owner: 'kavi',
  slug: 'openkavi-app',
  enabled: true,
  mode: 'eas-workflow',
  defaultBuildProfile: 'production',
  defaultUpdateBranch: 'production',
  updateChannel: 'production',
  platforms: ['android', 'ios'],
  ...overrides,
});

beforeEach(() => {
  useSettingsStore.setState({
    providers: [],
    mcpServers: [],
    sshTargets: [],
    workspaceTargets: [],
    browserProviders: [],
    expoAccounts: [],
    expoProjects: [],
    activeProviderId: null,
    activeModel: null,
    theme: 'dark',
    systemPrompt: 'You are a helpful personal AI assistant with access to tools.',
    lastUsedModel: null,
    thinkingLevel: 'medium',
    locale: 'en',
    webSearchProvider: 'auto',
    linkUnderstandingEnabled: true,
    mediaUnderstandingEnabled: true,
    maxLinks: 3,
    defaultConversationMode: 'agentic',
  });
});

describe('useSettingsStore', () => {
  describe('Providers', () => {
    it('should add a provider', () => {
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

    it('should set first added provider as active', () => {
      const provider = makeProvider();
      useSettingsStore.getState().addProvider(provider);

      expect(useSettingsStore.getState().activeProviderId).toBe('test-provider');
    });

    it('should not overwrite active provider when adding another', () => {
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p1' }));
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p2' }));

      expect(useSettingsStore.getState().activeProviderId).toBe('p1');
    });

    it('should update a provider', () => {
      useSettingsStore.getState().addProvider(makeProvider());
      useSettingsStore.getState().updateProvider(makeProvider({ name: 'Updated' }));

      expect(useSettingsStore.getState().providers[0].name).toBe('Updated');
    });

    it('should clear lastUsedModel when disabling provider', () => {
      useSettingsStore.getState().addProvider(makeProvider());
      useSettingsStore.getState().setLastUsedModel('test-provider', 'test-model');
      expect(useSettingsStore.getState().lastUsedModel).not.toBeNull();

      useSettingsStore.getState().updateProvider(makeProvider({ enabled: false }));
      expect(useSettingsStore.getState().lastUsedModel).toBeNull();
    });

    it('should fall back to the next enabled provider when disabling the active provider', () => {
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p1', model: 'gpt-5.4' }));
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p2', model: 'gpt-5-mini' }));

      useSettingsStore
        .getState()
        .updateProvider(makeProvider({ id: 'p1', model: 'gpt-5.4', enabled: false }));

      const state = useSettingsStore.getState();
      expect(state.activeProviderId).toBe('p2');
      expect(state.activeModel).toBe('gpt-5-mini');
    });

    it('should refresh the active model when the active provider model changes', () => {
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p1', model: 'gpt-5.4' }));
      useSettingsStore.getState().setActiveProviderAndModel('p1', 'gpt-5.4');

      useSettingsStore.getState().updateProvider(makeProvider({ id: 'p1', model: 'gpt-5.5' }));

      expect(useSettingsStore.getState().activeModel).toBe('gpt-5.5');
    });

    it('should remove a provider', () => {
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p1' }));
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p2' }));

      useSettingsStore.getState().removeProvider('p1');
      expect(useSettingsStore.getState().providers).toHaveLength(1);
      expect(useSettingsStore.getState().providers[0].id).toBe('p2');
    });

    it('should update active provider when removing the active one', () => {
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p1' }));
      useSettingsStore.getState().addProvider(makeProvider({ id: 'p2' }));

      useSettingsStore.getState().removeProvider('p1');
      expect(useSettingsStore.getState().activeProviderId).toBe('p2');
    });

    it('should set active to null when removing last provider', () => {
      useSettingsStore.getState().addProvider(makeProvider());
      useSettingsStore.getState().removeProvider('test-provider');

      expect(useSettingsStore.getState().activeProviderId).toBeNull();
    });

    it('should toggle model visibility', () => {
      useSettingsStore.getState().addProvider(makeProvider());

      useSettingsStore.getState().toggleModelVisibility('test-provider', 'model-a');
      expect(useSettingsStore.getState().providers[0].hiddenModels).toContain('model-a');

      useSettingsStore.getState().toggleModelVisibility('test-provider', 'model-a');
      expect(useSettingsStore.getState().providers[0].hiddenModels).not.toContain('model-a');
    });
  });

  describe('MCP Servers', () => {
    it('should add an MCP server', () => {
      useSettingsStore.getState().addMcpServer(makeMcpServer());
      expect(useSettingsStore.getState().mcpServers).toHaveLength(1);
    });

    it('should update an MCP server', () => {
      useSettingsStore.getState().addMcpServer(makeMcpServer());
      useSettingsStore.getState().updateMcpServer(makeMcpServer({ name: 'Updated MCP' }));
      expect(useSettingsStore.getState().mcpServers[0].name).toBe('Updated MCP');
    });

    it('should remove an MCP server', () => {
      useSettingsStore.getState().addMcpServer(makeMcpServer());
      useSettingsStore.getState().removeMcpServer('test-mcp');
      expect(useSettingsStore.getState().mcpServers).toHaveLength(0);
    });
  });

  describe('Theme', () => {
    it('should set theme', () => {
      useSettingsStore.getState().setTheme('light');
      expect(useSettingsStore.getState().theme).toBe('light');

      useSettingsStore.getState().setTheme('system');
      expect(useSettingsStore.getState().theme).toBe('system');
    });
  });

  describe('SSH Targets', () => {
    it('should add an SSH target', () => {
      useSettingsStore.getState().addSshTarget(makeSshTarget());
      expect(useSettingsStore.getState().sshTargets).toHaveLength(1);
    });

    it('should update an SSH target', () => {
      useSettingsStore.getState().addSshTarget(makeSshTarget());
      useSettingsStore.getState().updateSshTarget(makeSshTarget({ name: 'Runner' }));
      expect(useSettingsStore.getState().sshTargets[0].name).toBe('Runner');
    });

    it('should remove an SSH target', () => {
      useSettingsStore.getState().addSshTarget(makeSshTarget());
      useSettingsStore.getState().removeSshTarget('ssh-1');
      expect(useSettingsStore.getState().sshTargets).toHaveLength(0);
    });

    it('should clear linked workspace and Expo SSH references when removing an SSH target', () => {
      useSettingsStore.getState().addSshTarget(makeSshTarget());
      useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget({ sshTargetId: 'ssh-1' }));
      useSettingsStore
        .getState()
        .addExpoProject(makeExpoProject({ mode: 'direct-ssh', sshTargetId: 'ssh-1' }));

      useSettingsStore.getState().removeSshTarget('ssh-1');

      expect(useSettingsStore.getState().workspaceTargets[0].sshTargetId).toBeUndefined();
      expect(useSettingsStore.getState().expoProjects[0].sshTargetId).toBeUndefined();
    });
  });

  describe('Workspace Targets', () => {
    it('should add a workspace target', () => {
      useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());
      expect(useSettingsStore.getState().workspaceTargets).toHaveLength(1);
    });

    it('should update a workspace target', () => {
      useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());
      useSettingsStore
        .getState()
        .updateWorkspaceTarget(makeWorkspaceTarget({ rootPath: '/tmp/project' }));
      expect(useSettingsStore.getState().workspaceTargets[0].rootPath).toBe('/tmp/project');
    });

    it('should normalize workspace names and drop missing linked targets', () => {
      useSettingsStore.getState().addWorkspaceTarget(
        makeWorkspaceTarget({
          name: '   ',
          rootPath: '/tmp/my-repo',
          browserProviderId: 'missing-browser',
          sshTargetId: 'missing-ssh',
        }),
      );

      expect(useSettingsStore.getState().workspaceTargets[0]).toEqual(
        expect.objectContaining({
          name: 'my-repo',
          browserProviderId: undefined,
          sshTargetId: undefined,
        }),
      );
    });

    it('should remove a workspace target', () => {
      useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());
      useSettingsStore.getState().removeWorkspaceTarget('workspace-1');
      expect(useSettingsStore.getState().workspaceTargets).toHaveLength(0);
    });
  });

  describe('Browser Providers', () => {
    it('should add a browser provider', () => {
      useSettingsStore.getState().addBrowserProvider(makeBrowserProvider());
      expect(useSettingsStore.getState().browserProviders).toHaveLength(1);
    });

    it('should update a browser provider', () => {
      useSettingsStore.getState().addBrowserProvider(makeBrowserProvider());
      useSettingsStore
        .getState()
        .updateBrowserProvider(makeBrowserProvider({ authMode: 'query-token' }));
      expect(useSettingsStore.getState().browserProviders[0].authMode).toBe('query-token');
    });

    it('should remove a browser provider', () => {
      useSettingsStore.getState().addBrowserProvider(makeBrowserProvider());
      useSettingsStore.getState().removeBrowserProvider('browser-1');
      expect(useSettingsStore.getState().browserProviders).toHaveLength(0);
    });

    it('should clear linked browser providers from workspace targets when removing a browser provider', () => {
      useSettingsStore.getState().addBrowserProvider(makeBrowserProvider());
      useSettingsStore
        .getState()
        .addWorkspaceTarget(makeWorkspaceTarget({ browserProviderId: 'browser-1' }));

      useSettingsStore.getState().removeBrowserProvider('browser-1');

      expect(useSettingsStore.getState().workspaceTargets[0].browserProviderId).toBeUndefined();
    });
  });

  describe('Expo', () => {
    it('should add, update, and remove an Expo account', () => {
      useSettingsStore.getState().addExpoAccount(makeExpoAccount());
      useSettingsStore.getState().updateExpoAccount(makeExpoAccount({ owner: 'kavi-team' }));

      expect(useSettingsStore.getState().expoAccounts[0].owner).toBe('kavi-team');

      useSettingsStore.getState().removeExpoAccount('expo-account-1');
      expect(useSettingsStore.getState().expoAccounts).toHaveLength(0);
    });

    it('should remove linked Expo projects when deleting an Expo account', () => {
      useSettingsStore.getState().addExpoAccount(makeExpoAccount());
      useSettingsStore.getState().addExpoProject(makeExpoProject());
      useSettingsStore
        .getState()
        .addExpoProject(makeExpoProject({ id: 'expo-project-2', accountId: 'expo-account-2' }));

      useSettingsStore.getState().removeExpoAccount('expo-account-1');

      expect(useSettingsStore.getState().expoProjects).toEqual([
        expect.objectContaining({ id: 'expo-project-2', accountId: 'expo-account-2' }),
      ]);
    });

    it('should add, update, and remove an Expo project', () => {
      useSettingsStore.getState().addExpoProject(makeExpoProject());
      useSettingsStore.getState().updateExpoProject(makeExpoProject({ slug: 'openkavi-app-next' }));

      expect(useSettingsStore.getState().expoProjects[0].slug).toBe('openkavi-app-next');

      useSettingsStore.getState().removeExpoProject('expo-project-1');
      expect(useSettingsStore.getState().expoProjects).toHaveLength(0);
    });
  });

  describe('System Prompt', () => {
    it('should update system prompt', () => {
      useSettingsStore.getState().setSystemPrompt('Custom prompt');
      expect(useSettingsStore.getState().systemPrompt).toBe('Custom prompt');
    });
  });

  describe('Thinking Level', () => {
    it('should default to medium', () => {
      expect(useSettingsStore.getState().thinkingLevel).toBe('medium');
    });

    it('should update thinking level', () => {
      useSettingsStore.getState().setThinkingLevel('high');
      expect(useSettingsStore.getState().thinkingLevel).toBe('high');
    });
  });

  describe('Last Used Model', () => {
    it('should track last used model', () => {
      useSettingsStore.getState().setLastUsedModel('p1', 'gpt-5.4');
      expect(useSettingsStore.getState().lastUsedModel).toEqual({
        providerId: 'p1',
        model: 'gpt-5.4',
      });
    });

    it('should clear when provider removed', () => {
      useSettingsStore.getState().addProvider(makeProvider());
      useSettingsStore.getState().setLastUsedModel('test-provider', 'gpt-5.4');
      useSettingsStore.getState().removeProvider('test-provider');
      expect(useSettingsStore.getState().lastUsedModel).toBeNull();
    });

    it('should preserve the last used model when clearing the active provider selection', () => {
      useSettingsStore.getState().setLastUsedModel('p1', 'gpt-5.4');
      useSettingsStore.getState().setActiveProviderAndModel(null, null);

      expect(useSettingsStore.getState().lastUsedModel).toEqual({
        providerId: 'p1',
        model: 'gpt-5.4',
      });
    });
  });

  describe('replaceAllSettings', () => {
    it('should replace specified settings', () => {
      useSettingsStore.getState().replaceAllSettings({
        theme: 'light',
        systemPrompt: 'New prompt',
      });

      expect(useSettingsStore.getState().theme).toBe('light');
      expect(useSettingsStore.getState().systemPrompt).toBe('New prompt');
    });

    it('should preserve unspecified settings', () => {
      useSettingsStore.getState().addProvider(makeProvider());
      useSettingsStore.getState().replaceAllSettings({ theme: 'light' });

      expect(useSettingsStore.getState().providers).toHaveLength(1);
    });
  });

  describe('Locale', () => {
    it('should default to en', () => {
      expect(useSettingsStore.getState().locale).toBe('en');
    });

    it('should set locale', () => {
      useSettingsStore.getState().setLocale('fr');
      expect(useSettingsStore.getState().locale).toBe('fr');
    });
  });

  describe('Web Search Provider', () => {
    it('should default to auto', () => {
      expect(useSettingsStore.getState().webSearchProvider).toBe('auto');
    });

    it('should set the preferred web search provider', () => {
      useSettingsStore.getState().setWebSearchProvider('brave');
      expect(useSettingsStore.getState().webSearchProvider).toBe('brave');
    });
  });

  describe('Link Understanding', () => {
    it('should default to enabled', () => {
      expect(useSettingsStore.getState().linkUnderstandingEnabled).toBe(true);
    });

    it('should toggle link understanding', () => {
      useSettingsStore.getState().setLinkUnderstandingEnabled(false);
      expect(useSettingsStore.getState().linkUnderstandingEnabled).toBe(false);

      useSettingsStore.getState().setLinkUnderstandingEnabled(true);
      expect(useSettingsStore.getState().linkUnderstandingEnabled).toBe(true);
    });
  });

  describe('Media Understanding', () => {
    it('should default to enabled', () => {
      expect(useSettingsStore.getState().mediaUnderstandingEnabled).toBe(true);
    });

    it('should toggle media understanding', () => {
      useSettingsStore.getState().setMediaUnderstandingEnabled(false);
      expect(useSettingsStore.getState().mediaUnderstandingEnabled).toBe(false);
    });
  });

  describe('Max Links', () => {
    it('should default to 3', () => {
      expect(useSettingsStore.getState().maxLinks).toBe(3);
    });

    it('should set max links', () => {
      useSettingsStore.getState().setMaxLinks(5);
      expect(useSettingsStore.getState().maxLinks).toBe(5);
    });

    it('should clamp max links to minimum 1', () => {
      useSettingsStore.getState().setMaxLinks(0);
      expect(useSettingsStore.getState().maxLinks).toBe(1);

      useSettingsStore.getState().setMaxLinks(-5);
      expect(useSettingsStore.getState().maxLinks).toBe(1);
    });

    it('should clamp max links to maximum 10', () => {
      useSettingsStore.getState().setMaxLinks(15);
      expect(useSettingsStore.getState().maxLinks).toBe(10);
    });
  });

  describe('replaceAllSettings', () => {
    it('should replace preference fields alongside main settings', () => {
      useSettingsStore.getState().replaceAllSettings({
        theme: 'light',
        systemPrompt: 'Custom prompt',
        thinkingLevel: 'high',
        locale: 'fr',
        webSearchProvider: 'gemini',
        linkUnderstandingEnabled: false,
        mediaUnderstandingEnabled: false,
        maxLinks: 7,
        defaultConversationMode: 'direct',
      } as any);

      const state = useSettingsStore.getState();
      expect(state.theme).toBe('light');
      expect(state.systemPrompt).toBe('Custom prompt');
      expect(state.thinkingLevel).toBe('high');
      expect(state.locale).toBe('fr');
      expect(state.webSearchProvider).toBe('gemini');
      expect(state.linkUnderstandingEnabled).toBe(false);
      expect(state.mediaUnderstandingEnabled).toBe(false);
      expect(state.maxLinks).toBe(7);
      expect(state.defaultConversationMode).toBe('direct');
    });

    it('should clear nullable selections when explicitly set to null', () => {
      useSettingsStore.getState().addProvider(makeProvider());
      useSettingsStore.getState().setActiveProviderAndModel('test-provider', 'gpt-5.4');
      useSettingsStore.getState().setLastUsedModel('test-provider', 'gpt-5.4');

      useSettingsStore.getState().replaceAllSettings({
        activeProviderId: null,
        activeModel: null,
        lastUsedModel: null,
      });

      const state = useSettingsStore.getState();
      expect(state.activeProviderId).toBeNull();
      expect(state.activeModel).toBeNull();
      expect(state.lastUsedModel).toBeNull();
    });

    it('should clamp maxLinks when replacing settings', () => {
      useSettingsStore.getState().replaceAllSettings({ maxLinks: 99 });
      expect(useSettingsStore.getState().maxLinks).toBe(10);

      useSettingsStore.getState().replaceAllSettings({ maxLinks: 0 });
      expect(useSettingsStore.getState().maxLinks).toBe(1);
    });

    it('should preserve existing preferences when partial settings provided', () => {
      useSettingsStore.getState().setThinkingLevel('high');
      useSettingsStore.getState().setLocale('ja' as any);

      useSettingsStore.getState().replaceAllSettings({ theme: 'light' });

      const state = useSettingsStore.getState();
      expect(state.theme).toBe('light');
      expect(state.thinkingLevel).toBe('high');
      expect(state.locale).toBe('ja');
    });

    it('should replace browser and Expo collections when provided', () => {
      useSettingsStore.getState().replaceAllSettings({
        browserProviders: [makeBrowserProvider()],
        expoAccounts: [makeExpoAccount()],
        expoProjects: [makeExpoProject()],
      });

      const state = useSettingsStore.getState();
      expect(state.browserProviders).toHaveLength(1);
      expect(state.expoAccounts).toHaveLength(1);
      expect(state.expoProjects).toHaveLength(1);
    });
  });

  describe('Conversation Mode', () => {
    it('should update the default conversation mode', () => {
      useSettingsStore.getState().setDefaultConversationMode('direct');
      expect(useSettingsStore.getState().defaultConversationMode).toBe('direct');
    });
  });

  describe('Persist Configuration', () => {
    it('should migrate legacy persisted state up to version 6 defaults', async () => {
      const persistOptions = (useSettingsStore as any).persist.getOptions();
      const migrated = await persistOptions.migrate(
        {
          providers: [makeProvider()],
        },
        1,
      );

      expect(migrated).toEqual(
        expect.objectContaining({
          webSearchProvider: 'auto',
          sshTargets: [],
          workspaceTargets: [],
          browserProviders: [],
          expoAccounts: [],
          expoProjects: [],
          defaultConversationMode: 'agentic',
        }),
      );
    });

    it('should sanitize stale workspace links during the version 8 migration', async () => {
      const persistOptions = (useSettingsStore as any).persist.getOptions();
      const migrated = await persistOptions.migrate(
        {
          providers: [makeProvider()],
          browserProviders: [makeBrowserProvider()],
          sshTargets: [makeSshTarget()],
          workspaceTargets: [
            makeWorkspaceTarget({
              id: 'workspace-1',
              name: '   ',
              browserProviderId: 'missing-browser',
              sshTargetId: 'ssh-1',
            }),
            makeWorkspaceTarget({
              id: 'workspace-2',
              name: '   ',
              rootPath: '/tmp/another-repo',
              browserProviderId: 'browser-1',
              sshTargetId: 'missing-ssh',
            }),
          ],
          expoProjects: [makeExpoProject({ sshTargetId: 'missing-ssh' })],
        },
        7,
      );

      expect(migrated.workspaceTargets).toEqual([
        expect.objectContaining({
          id: 'workspace-1',
          name: 'project',
          browserProviderId: undefined,
          sshTargetId: 'ssh-1',
        }),
        expect.objectContaining({
          id: 'workspace-2',
          name: 'another-repo',
          browserProviderId: 'browser-1',
          sshTargetId: undefined,
        }),
      ]);
      expect(migrated.expoProjects[0].sshTargetId).toBeUndefined();
    });

    it('should partialize persisted state without plain-text provider API keys', () => {
      const persistOptions = (useSettingsStore as any).persist.getOptions();
      const partialized = persistOptions.partialize({
        ...useSettingsStore.getState(),
        providers: [makeProvider({ apiKey: 'sk-secret' })],
        browserProviders: [makeBrowserProvider()],
        expoAccounts: [makeExpoAccount()],
        expoProjects: [makeExpoProject()],
        defaultConversationMode: 'direct',
      });

      expect(partialized).toEqual(
        expect.objectContaining({
          providers: [expect.objectContaining({ apiKey: '' })],
          browserProviders: [expect.objectContaining({ id: 'browser-1' })],
          expoAccounts: [expect.objectContaining({ id: 'expo-account-1' })],
          expoProjects: [expect.objectContaining({ id: 'expo-project-1' })],
          defaultConversationMode: 'direct',
        }),
      );
    });
  });
});
