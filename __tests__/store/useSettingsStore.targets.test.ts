import {
  makeBrowserProvider,
  makeExpoAccount,
  makeExpoProject,
  makeProvider,
  makeSshTarget,
  makeWorkspaceTarget,
  resetSettingsStore,
} from '../helpers/settingsStoreFixtures';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { migrateSettingsState } from '../../src/store/settingsStorePersistence';

beforeEach(() => {
  resetSettingsStore();
});

describe('useSettingsStore SSH target settings', () => {
  it('adds an SSH target', () => {
    useSettingsStore.getState().addSshTarget(makeSshTarget());
    expect(useSettingsStore.getState().sshTargets).toHaveLength(1);
  });

  it('updates an SSH target', () => {
    useSettingsStore.getState().addSshTarget(makeSshTarget());
    useSettingsStore.getState().updateSshTarget(makeSshTarget({ name: 'Runner' }));
    expect(useSettingsStore.getState().sshTargets[0].name).toBe('Runner');
  });

  it('removes an SSH target', () => {
    useSettingsStore.getState().addSshTarget(makeSshTarget());
    useSettingsStore.getState().removeSshTarget('ssh-1');
    expect(useSettingsStore.getState().sshTargets).toHaveLength(0);
  });

  it('clears linked workspace and Expo SSH references when removing an SSH target', () => {
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

describe('useSettingsStore workspace target settings', () => {
  it('adds a workspace target', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());
    expect(useSettingsStore.getState().workspaceTargets).toHaveLength(1);
  });

  it('updates a workspace target', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());
    useSettingsStore
      .getState()
      .updateWorkspaceTarget(makeWorkspaceTarget({ rootPath: '/tmp/project' }));
    expect(useSettingsStore.getState().workspaceTargets[0].rootPath).toBe('/tmp/project');
  });

  it('normalizes workspace names and drops missing linked targets', () => {
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

  it('removes a workspace target', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());
    useSettingsStore.getState().removeWorkspaceTarget('workspace-1');
    expect(useSettingsStore.getState().workspaceTargets).toHaveLength(0);
  });

  it('auto-resolves the default workspace target when only one enabled target exists', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());

    expect(useSettingsStore.getState().defaultWorkspaceTargetId).toBe('workspace-1');
  });

  it('keeps an explicit default workspace target when multiple enabled targets exist', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget({ id: 'workspace-1' }));
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget({ id: 'workspace-2' }));

    useSettingsStore.getState().setDefaultWorkspaceTargetId('workspace-2');

    expect(useSettingsStore.getState().defaultWorkspaceTargetId).toBe('workspace-2');
  });

  it('clears an invalid default workspace target when multiple enabled targets exist', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget({ id: 'workspace-1' }));
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget({ id: 'workspace-2' }));

    useSettingsStore.getState().setDefaultWorkspaceTargetId('missing');

    expect(useSettingsStore.getState().defaultWorkspaceTargetId).toBeNull();
  });

  it('falls back to the only remaining enabled workspace target when deleting the default', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget({ id: 'workspace-1' }));
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget({ id: 'workspace-2' }));
    useSettingsStore.getState().setDefaultWorkspaceTargetId('workspace-1');

    useSettingsStore.getState().removeWorkspaceTarget('workspace-1');

    expect(useSettingsStore.getState().defaultWorkspaceTargetId).toBe('workspace-2');
  });
});

describe('useSettingsStore browser provider settings', () => {
  it('adds a browser provider', () => {
    useSettingsStore.getState().addBrowserProvider(makeBrowserProvider());
    expect(useSettingsStore.getState().browserProviders).toHaveLength(1);
  });

  it('updates a browser provider', () => {
    useSettingsStore.getState().addBrowserProvider(makeBrowserProvider());
    useSettingsStore
      .getState()
      .updateBrowserProvider(makeBrowserProvider({ authMode: 'query-token' }));
    expect(useSettingsStore.getState().browserProviders[0].authMode).toBe('query-token');
  });

  it('removes a browser provider', () => {
    useSettingsStore.getState().addBrowserProvider(makeBrowserProvider());
    useSettingsStore.getState().removeBrowserProvider('browser-1');
    expect(useSettingsStore.getState().browserProviders).toHaveLength(0);
  });

  it('clears linked browser providers from workspace targets when removing a provider', () => {
    useSettingsStore.getState().addBrowserProvider(makeBrowserProvider());
    useSettingsStore
      .getState()
      .addWorkspaceTarget(makeWorkspaceTarget({ browserProviderId: 'browser-1' }));

    useSettingsStore.getState().removeBrowserProvider('browser-1');

    expect(useSettingsStore.getState().workspaceTargets[0].browserProviderId).toBeUndefined();
  });
});

describe('useSettingsStore Expo settings', () => {
  it('adds, updates, and removes an Expo account', () => {
    useSettingsStore.getState().addExpoAccount(makeExpoAccount());
    useSettingsStore.getState().updateExpoAccount(makeExpoAccount({ owner: 'kavi-team' }));

    expect(useSettingsStore.getState().expoAccounts[0].owner).toBe('kavi-team');

    useSettingsStore.getState().removeExpoAccount('expo-account-1');
    expect(useSettingsStore.getState().expoAccounts).toHaveLength(0);
  });

  it('removes linked Expo projects when deleting an Expo account', () => {
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

  it('adds, updates, and removes an Expo project', () => {
    useSettingsStore.getState().addExpoProject(makeExpoProject());
    useSettingsStore
      .getState()
      .updateExpoProject(makeExpoProject({ slug: 'openkavi-app-next' }));

    expect(useSettingsStore.getState().expoProjects[0].slug).toBe('openkavi-app-next');

    useSettingsStore.getState().removeExpoProject('expo-project-1');
    expect(useSettingsStore.getState().expoProjects).toHaveLength(0);
  });
});

describe('useSettingsStore replacement settings', () => {
  it('replaces specified settings', () => {
    useSettingsStore.getState().replaceAllSettings({
      theme: 'light',
      systemPrompt: 'New prompt',
    });

    expect(useSettingsStore.getState().theme).toBe('light');
    expect(useSettingsStore.getState().systemPrompt).toBe('New prompt');
  });

  it('preserves unspecified settings', () => {
    useSettingsStore.getState().addProvider(makeProvider());
    useSettingsStore.getState().replaceAllSettings({ theme: 'light' });

    expect(useSettingsStore.getState().providers).toHaveLength(1);
  });

  it('replaces preference fields alongside main settings', () => {
    useSettingsStore.getState().replaceAllSettings({
      theme: 'light',
      systemPrompt: 'Custom prompt',
      thinkingLevel: 'high',
      locale: 'fr',
      webSearchProvider: 'kimi',
      linkUnderstandingEnabled: false,
      mediaUnderstandingEnabled: false,
      maxLinks: 7,
      defaultConversationMode: 'chitchat',
    } as any);

    const state = useSettingsStore.getState();
    expect(state.theme).toBe('light');
    expect(state.systemPrompt).toBe('Custom prompt');
    expect(state.thinkingLevel).toBe('high');
    expect(state.locale).toBe('fr');
    expect(state.webSearchProvider).toBe('kimi');
    expect(state.linkUnderstandingEnabled).toBe(false);
    expect(state.mediaUnderstandingEnabled).toBe(false);
    expect(state.maxLinks).toBe(7);
    expect(state.defaultConversationMode).toBe('chitchat');
  });

  it('preserves Gemini as a supported web search provider', () => {
    useSettingsStore.getState().replaceAllSettings({
      webSearchProvider: 'gemini',
    } as any);

    expect(useSettingsStore.getState().webSearchProvider).toBe('gemini');
  });

  it('clears nullable selections when explicitly set to null', () => {
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

  it('clamps maxLinks when replacing settings', () => {
    useSettingsStore.getState().replaceAllSettings({ maxLinks: 99 });
    expect(useSettingsStore.getState().maxLinks).toBe(10);

    useSettingsStore.getState().replaceAllSettings({ maxLinks: 0 });
    expect(useSettingsStore.getState().maxLinks).toBe(1);
  });

  it('preserves existing preferences when partial settings are provided', () => {
    useSettingsStore.getState().setThinkingLevel('high');
    useSettingsStore.getState().setLocale('ja' as any);

    useSettingsStore.getState().replaceAllSettings({ theme: 'light' });

    const state = useSettingsStore.getState();
    expect(state.theme).toBe('light');
    expect(state.thinkingLevel).toBe('high');
    expect(state.locale).toBe('ja');
  });

  it('replaces browser and Expo collections when provided', () => {
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

describe('useSettingsStore persistence settings', () => {
  it('passes through empty persisted state during migration', () => {
    expect(migrateSettingsState(null, 1)).toBeNull();
  });

  it('migrates legacy persisted state up to version 6 defaults', async () => {
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

  it('sanitizes stale workspace links during the version 8 migration', async () => {
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

  it('partializes persisted state without plain-text provider API keys', () => {
    const persistOptions = (useSettingsStore as any).persist.getOptions();
    const partialized = persistOptions.partialize({
      ...useSettingsStore.getState(),
      providers: [makeProvider({ apiKey: 'sk-secret' })],
      browserProviders: [makeBrowserProvider()],
      expoAccounts: [makeExpoAccount()],
      expoProjects: [makeExpoProject()],
      defaultConversationMode: 'chitchat',
    });

    expect(partialized).toEqual(
      expect.objectContaining({
        providers: [expect.objectContaining({ apiKey: '' })],
        browserProviders: [expect.objectContaining({ id: 'browser-1' })],
        expoAccounts: [expect.objectContaining({ id: 'expo-account-1' })],
        expoProjects: [expect.objectContaining({ id: 'expo-project-1' })],
        defaultConversationMode: 'chitchat',
      }),
    );
  });
});
