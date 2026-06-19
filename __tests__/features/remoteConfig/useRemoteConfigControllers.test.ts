import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useBrowserConfigController } from '../../../src/features/remoteConfig/hooks/useBrowserConfigController';
import { useExpoConfigController } from '../../../src/features/remoteConfig/hooks/useExpoConfigController';
import { useMcpConfigController } from '../../../src/features/remoteConfig/hooks/useMcpConfigController';
import { useRemoteConfigSettingsSlice } from '../../../src/features/remoteConfig/hooks/useRemoteConfigStore';
import { useSshConfigController } from '../../../src/features/remoteConfig/hooks/useSshConfigController';
import { useWorkspaceConfigController } from '../../../src/features/remoteConfig/hooks/useWorkspaceConfigController';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const mockSaveSecure = jest.fn<Promise<void>, [string, string]>();
const mockDeleteSecure = jest.fn<Promise<void>, [string]>();
const mockGetMcpOAuthClientSecret = jest.fn<Promise<string>, [string]>();
const mockSaveMcpOAuthClientSecret = jest.fn<Promise<void>, [string, string]>();
const mockDeleteMcpOAuthClientSecret = jest.fn<Promise<void>, [string]>();
const mockGetSshHostFingerprint = jest.fn<
  Promise<string>,
  [{ host: string; username: string; port: number }]
>();
const mockSyncExpoAccountProjects = jest.fn<Promise<{ projectCount: number }>, [string]>();
const mockHasStoredMcpOAuth = jest.fn<Promise<boolean>, [string]>();
const mockClearMcpOAuth = jest.fn<Promise<void>, [string]>();

jest.mock('../../../src/services/storage/SecureStorage', () => ({
  saveSecure: (...args: [string, string]) => mockSaveSecure(...args),
  deleteSecure: (...args: [string]) => mockDeleteSecure(...args),
  getMcpOAuthClientSecret: (...args: [string]) => mockGetMcpOAuthClientSecret(...args),
  saveMcpOAuthClientSecret: (...args: [string, string]) => mockSaveMcpOAuthClientSecret(...args),
  deleteMcpOAuthClientSecret: (...args: [string]) => mockDeleteMcpOAuthClientSecret(...args),
}));

jest.mock('../../../src/services/ssh/connector', () => ({
  getSshHostFingerprint: (...args: [{ host: string; username: string; port: number }]) =>
    mockGetSshHostFingerprint(...args),
}));

jest.mock('../../../src/services/expo/projectSync', () => ({
  syncExpoAccountProjects: (...args: [string]) => mockSyncExpoAccountProjects(...args),
}));

jest.mock('../../../src/services/mcp/oauth', () => ({
  hasStoredMcpOAuth: (...args: [string]) => mockHasStoredMcpOAuth(...args),
  clearMcpOAuth: (...args: [string]) => mockClearMcpOAuth(...args),
}));

const t = (key: string, params?: Record<string, unknown>) => {
  if (params && typeof params.count === 'number') {
    return `${key}:${String(params.count)}`;
  }
  return key;
};

const makeWorkspaceTarget = (overrides: Record<string, unknown> = {}) => ({
  id: 'workspace-1',
  name: '',
  rootPath: '/Users/example/project',
  configRoots: ['/Users/example/.config'],
  provider: 'code-server' as const,
  authMode: 'none' as const,
  enabled: true,
  ...overrides,
});

const makeSshTarget = (overrides: Record<string, unknown> = {}) => ({
  id: 'ssh-1',
  name: 'Build Box',
  host: 'ssh.example.com',
  port: 22,
  username: 'developer',
  authMode: 'password' as const,
  hostKeyPolicy: 'trust-on-first-use' as const,
  ptyType: 'xterm' as const,
  enabled: true,
  ...overrides,
});

const makeBrowserProvider = (overrides: Record<string, unknown> = {}) => ({
  id: 'browser-1',
  name: 'Browserbase',
  provider: 'browserbase' as const,
  baseUrl: 'https://api.browserbase.com',
  authMode: 'api-key-header' as const,
  projectId: 'bb_project_123',
  enabled: true,
  ...overrides,
});

const makeExpoAccount = (overrides: Record<string, unknown> = {}) => ({
  id: 'expo-account-1',
  name: 'Expo Production',
  owner: 'kavi',
  accountType: 'personal' as const,
  enabled: true,
  ...overrides,
});

const makeExpoProject = (overrides: Record<string, unknown> = {}) => ({
  id: 'expo-project-1',
  name: 'Kavi Mobile',
  accountId: 'expo-account-1',
  owner: 'kavi',
  slug: 'openkavi-app',
  enabled: true,
  mode: 'eas-workflow' as const,
  defaultBuildProfile: 'production',
  defaultUpdateBranch: 'production',
  updateChannel: 'production',
  platforms: ['android', 'ios'],
  ...overrides,
});

const makeMcpServer = (overrides: Record<string, unknown> = {}) => ({
  id: 'mcp-1',
  name: 'Primary MCP',
  url: 'https://mcp.example.com',
  enabled: true,
  tools: [],
  allowedTools: [],
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
  jest.clearAllMocks();
  mockSaveSecure.mockResolvedValue(undefined);
  mockDeleteSecure.mockResolvedValue(undefined);
  mockGetMcpOAuthClientSecret.mockResolvedValue('');
  mockSaveMcpOAuthClientSecret.mockResolvedValue(undefined);
  mockDeleteMcpOAuthClientSecret.mockResolvedValue(undefined);
  mockGetSshHostFingerprint.mockResolvedValue('SHA256:abc123');
  mockSyncExpoAccountProjects.mockResolvedValue({ projectCount: 0 });
  mockHasStoredMcpOAuth.mockResolvedValue(false);
  mockClearMcpOAuth.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('remote config controllers', () => {
  it('saves a workspace target and persists its access token', async () => {
    useSettingsStore.setState({
      browserProviders: [makeBrowserProvider()],
      sshTargets: [makeSshTarget()],
    });

    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useWorkspaceConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
      result.current.setDraft((current) =>
        current
          ? {
              ...current,
              id: 'workspace-1',
              rootPath: '/Users/example/project',
              baseUrl: 'https://workspace.example.com',
              authMode: 'bearer',
              browserProviderId: 'browser-1',
              sshTargetId: 'ssh-1',
            }
          : current,
      );
      result.current.setWorkspaceAccessToken('secret-token');
      result.current.setWorkspaceConfigRootsText('/Users/example/.config\n/tmp/workspace');
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockSaveSecure).toHaveBeenCalledWith(
      'workspace_access_token_workspace-1',
      'secret-token',
    );
    expect(useSettingsStore.getState().workspaceTargets).toEqual([
      expect.objectContaining({
        id: 'workspace-1',
        name: 'project',
        rootPath: '/Users/example/project',
        accessTokenRef: 'workspace_access_token_workspace-1',
        browserProviderId: 'browser-1',
        sshTargetId: 'ssh-1',
        configRoots: ['/Users/example/.config', '/tmp/workspace'],
      }),
    ]);
  });

  it('rejects saving a workspace target without a root path', async () => {
    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useWorkspaceConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
    });

    await act(async () => {
      await result.current.save();
    });

    expect(Alert.alert).toHaveBeenCalledWith('common.error', 'settings.workspaceRootRequired');
  });

  it('deletes a workspace target and clears its stored token', async () => {
    useSettingsStore
      .getState()
      .addWorkspaceTarget(
        makeWorkspaceTarget({ accessTokenRef: 'workspace_access_token_workspace-1' }),
      );

    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useWorkspaceConfigController({ settings, t });
    });

    act(() => {
      result.current.remove('workspace-1');
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1]?.onPress?.();
    });

    expect(mockDeleteSecure).toHaveBeenCalledWith('workspace_access_token_workspace-1');
    expect(useSettingsStore.getState().workspaceTargets).toEqual([]);
  });

  it('fetches an SSH fingerprint and saves a private-key target', async () => {
    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useSshConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
      result.current.setDraft((current) =>
        current
          ? {
              ...current,
              id: 'ssh-1',
              host: 'ssh.example.com',
              username: 'developer',
              authMode: 'private-key',
              hostKeyPolicy: 'strict',
            }
          : current,
      );
      result.current.setSshPortText('2200');
      result.current.setSshPrivateKey('PRIVATE KEY');
      result.current.setSshPassphrase('passphrase');
    });

    await act(async () => {
      await result.current.fetchFingerprint();
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockGetSshHostFingerprint).toHaveBeenCalledWith({
      host: 'ssh.example.com',
      username: 'developer',
      port: 2200,
    });
    expect(mockSaveSecure).toHaveBeenCalledWith('ssh_private_key_ssh-1', 'PRIVATE KEY');
    expect(mockSaveSecure).toHaveBeenCalledWith('ssh_passphrase_ssh-1', 'passphrase');
    expect(useSettingsStore.getState().sshTargets).toEqual([
      expect.objectContaining({
        id: 'ssh-1',
        host: 'ssh.example.com',
        port: 2200,
        authMode: 'private-key',
        privateKeyRef: 'ssh_private_key_ssh-1',
        passphraseRef: 'ssh_passphrase_ssh-1',
        trustedHostFingerprint: 'SHA256:ABC123',
      }),
    ]);
  });

  it('saves a browser provider with a stored API key', async () => {
    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useBrowserConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
      result.current.setDraft((current) =>
        current
          ? {
              ...current,
              id: 'browser-1',
              name: 'Browserbase',
              provider: 'browserbase',
              projectId: 'bb_project_123',
            }
          : current,
      );
      result.current.setBrowserApiKey('browser-secret');
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockSaveSecure).toHaveBeenCalledWith(
      'browser_provider_api_key_browser-1',
      'browser-secret',
    );
    expect(useSettingsStore.getState().browserProviders).toEqual([
      expect.objectContaining({
        id: 'browser-1',
        apiKeyRef: 'browser_provider_api_key_browser-1',
        projectId: 'bb_project_123',
      }),
    ]);
  });

  it('rejects a browser provider without a Browserbase project id', async () => {
    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useBrowserConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
      result.current.setDraft((current) =>
        current
          ? {
              ...current,
              provider: 'browserbase',
              projectId: '',
            }
          : current,
      );
      result.current.setBrowserApiKey('browser-secret');
    });

    await act(async () => {
      await result.current.save();
    });

    expect(Alert.alert).toHaveBeenCalledWith('common.error', 'settings.browserProjectRequired');
  });

  it('saves an Expo account, stores its token, and syncs projects', async () => {
    mockSyncExpoAccountProjects.mockImplementation(async (accountId) => {
      useSettingsStore
        .getState()
        .addExpoProject(
          makeExpoProject({
            id: 'synced-project',
            accountId,
            owner: 'kavi-team',
            slug: 'synced-app',
          }),
        );
      return { projectCount: 1 };
    });

    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useExpoConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
      result.current.setExpoAccountDraft((current) =>
        current
          ? {
              ...current,
              id: 'expo-account-1',
              name: 'Expo Team',
              owner: 'kavi-team',
            }
          : current,
      );
      result.current.setExpoAccountToken('expo-secret');
    });

    await act(async () => {
      await result.current.saveAccount();
    });

    expect(mockSaveSecure).toHaveBeenCalledWith('expo_account_token_expo-account-1', 'expo-secret');
    expect(mockSyncExpoAccountProjects).toHaveBeenCalledWith('expo-account-1');
    expect(useSettingsStore.getState().expoAccounts).toEqual([
      expect.objectContaining({
        id: 'expo-account-1',
        owner: 'kavi-team',
        tokenRef: 'expo_account_token_expo-account-1',
      }),
    ]);
    expect(Alert.alert).toHaveBeenCalledWith(
      'settings.expoProjectsSyncedTitle',
      'settings.expoProjectsSyncedCount:1',
    );
  });

  it('validates and saves a GitHub workflow Expo project', async () => {
    useSettingsStore.getState().addExpoAccount(makeExpoAccount());

    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useExpoConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
      result.current.setExpoProjectDraft((current) =>
        current
          ? {
              ...current,
              id: 'expo-project-1',
              accountId: 'expo-account-1',
              owner: 'kavi',
              slug: 'mobile-app',
              mode: 'github-workflow',
              repoFullName: 'kavi/mobile',
              workflowFile: '.github/workflows/build.yml',
              platforms: ['android', 'ios'],
            }
          : current,
      );
    });

    await act(async () => {
      await result.current.saveProject();
    });

    expect(useSettingsStore.getState().expoProjects).toEqual([
      expect.objectContaining({
        id: 'expo-project-1',
        name: 'kavi/mobile-app',
        repoFullName: 'kavi/mobile',
        workflowFile: '.github/workflows/build.yml',
      }),
    ]);
  });

  it('rejects an Expo project without a linked account', async () => {
    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useExpoConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
    });

    await act(async () => {
      await result.current.saveProject();
    });

    expect(Alert.alert).toHaveBeenCalledWith('common.error', 'settings.expoLinkedAccountRequired');
  });

  it('deletes an Expo account and clears its stored token', async () => {
    useSettingsStore
      .getState()
      .addExpoAccount(makeExpoAccount({ tokenRef: 'expo_account_token_expo-account-1' }));

    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useExpoConfigController({ settings, t });
    });

    act(() => {
      result.current.removeAccount('expo-account-1');
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1]?.onPress?.();
    });

    expect(mockDeleteSecure).toHaveBeenCalledWith('expo_account_token_expo-account-1');
    expect(useSettingsStore.getState().expoAccounts).toEqual([]);
  });

  it('saves an MCP server with normalized metadata and a stored token', async () => {
    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useMcpConfigController({ settings, t });
    });

    act(() => {
      result.current.openNew();
      result.current.setDraft((current) =>
        current
          ? {
              ...current,
              id: 'mcp-1',
              name: 'Primary MCP',
              url: 'https://mcp.example.com',
            }
          : current,
      );
      result.current.setMcpToken('mcp-secret');
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockSaveSecure).toHaveBeenCalledWith('mcp_server_token_mcp-1', 'mcp-secret');
    expect(useSettingsStore.getState().mcpServers).toEqual([
      expect.objectContaining({
        id: 'mcp-1',
        tokenRef: 'mcp_server_token_mcp-1',
        capabilities: expect.objectContaining({ authMode: 'header' }),
      }),
    ]);
  });

  it('deletes an MCP server and clears its stored token', async () => {
    useSettingsStore.getState().addMcpServer(makeMcpServer({ tokenRef: 'mcp_server_token_mcp-1' }));

    const { result } = renderHook(() => {
      const settings = useRemoteConfigSettingsSlice();
      return useMcpConfigController({ settings, t });
    });

    act(() => {
      result.current.remove('mcp-1');
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1]?.onPress?.();
    });

    expect(mockDeleteSecure).toHaveBeenCalledWith('mcp_server_token_mcp-1');
    expect(useSettingsStore.getState().mcpServers).toEqual([]);
  });
});
