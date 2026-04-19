import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RemoteWorkScreen } from '../../src/screens/RemoteWorkScreen';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockResolveWorkspaceTargetLaunch = jest.fn();
const mockProbeWorkspaceTarget = jest.fn();
const mockGetWorkspaceTargetControlStatus = jest.fn();
const mockProbeSshTarget = jest.fn();
const mockProbeBrowserProvider = jest.fn();
const mockLaunchBrowserLiveSession = jest.fn();
const mockStopBrowserLiveSession = jest.fn();
const mockOpenShellSession = jest.fn();
const mockWriteShellInput = jest.fn();
const mockCloseShellSession = jest.fn();
const mockProbeExpoProject = jest.fn();
const mockRunExpoProjectAction = jest.fn();
const mockSyncExpoAccountProjects = jest.fn();
const mockGetSecure = jest.fn();
const mockTerminalRef = {
  write: jest.fn(),
  writeln: jest.fn(),
  clear: jest.fn(),
  reset: jest.fn(),
  focus: jest.fn(),
  paste: jest.fn(),
  search: jest.fn(),
  updateTheme: jest.fn(),
  updateConfig: jest.fn(),
  fit: jest.fn(),
};
let mockInteractiveTerminalProps: any = null;

const getSettingsState = () =>
  require('../../src/store/useSettingsStore').useSettingsStore.getState();
const getSecureStorageMocks = () => require('../../src/services/storage/SecureStorage');

const defaultWorkspaceTargets = () => [
  {
    id: 'ws-1',
    name: 'Main Repo',
    rootPath: '/workspace/repo',
    baseUrl: 'https://code.example.com',
    provider: 'code-server',
    enabled: true,
  },
];

const defaultSshTargets = () => [
  {
    id: 'ssh-1',
    name: 'Build box',
    host: 'ssh.example.com',
    port: 22,
    username: 'developer',
    authMode: 'password',
    passwordRef: 'ssh_password_ssh-1',
    enabled: true,
  },
];

const defaultBrowserProviders = () => [
  {
    id: 'browser-1',
    name: 'Primary Browserbase',
    provider: 'browserbase',
    baseUrl: 'https://api.browserbase.com',
    projectId: 'proj_123',
    authMode: 'api-key-header',
    apiKeyRef: 'browser_provider_api_key_browser-1',
    enabled: true,
  },
];

const defaultMcpServers = () => [
  {
    id: 'mcp-1',
    name: 'Tool Server',
    url: 'https://mcp.example.com',
    transport: 'auto',
    enabled: true,
    tools: [],
    allowedTools: [],
  },
];

const defaultExpoAccounts = () => [
  {
    id: 'expo-account-1',
    name: 'Expo Prod',
    owner: 'kavi',
    tokenRef: 'expo_account_token_expo-account-1',
    enabled: true,
  },
];

const defaultExpoProjects = () => [
  {
    id: 'expo-project-1',
    easProjectId: 'eas-project-1',
    name: 'Kavi',
    accountId: 'expo-account-1',
    owner: 'kavi',
    slug: 'kavi-app',
    enabled: true,
    mode: 'direct-ssh',
    sshTargetId: 'ssh-1',
    projectPath: '/srv/kavi-app',
    defaultBuildProfile: 'production',
    defaultUpdateBranch: 'production',
    updateChannel: 'production',
    platforms: ['android', 'ios', 'web'],
    webUrl: 'https://app.example.com',
  },
];

const resetSettingsState = () => {
  const state = getSettingsState();
  state.workspaceTargets = defaultWorkspaceTargets();
  state.sshTargets = defaultSshTargets();
  state.browserProviders = defaultBrowserProviders();
  state.mcpServers = defaultMcpServers();
  state.expoAccounts = defaultExpoAccounts();
  state.expoProjects = defaultExpoProjects();
};

const confirmDestructiveAlert = () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: any) => {
    const destructive = buttons?.find((button: any) => button.style === 'destructive');
    destructive?.onPress?.();
  });
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    navigate: mockNavigate,
  }),
  useRoute: () => ({ name: 'RemoteWork' }),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: (props: any) => React.createElement(View, { ...props }),
  };
});

jest.mock('../../src/components/terminal/InteractiveTerminalSurface', () => {
  const React = require('react');
  const { View } = require('react-native');
  const InteractiveTerminalSurface = React.forwardRef((props: any, ref: any) => {
    mockInteractiveTerminalProps = props;
    React.useImperativeHandle(ref, () => mockTerminalRef);
    return React.createElement(View, { testID: 'mock-interactive-terminal-surface' });
  });
  InteractiveTerminalSurface.displayName = 'InteractiveTerminalSurface';
  return { InteractiveTerminalSurface };
});

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#161616',
      panel: '#0d0d0d',
      header: '#111',
      border: '#333',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#032',
      danger: '#f00',
      success: '#0d0',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/store/useSettingsStore', () => {
  const state = {
    workspaceTargets: defaultWorkspaceTargets(),
    sshTargets: defaultSshTargets(),
    browserProviders: defaultBrowserProviders(),
    mcpServers: defaultMcpServers(),
    expoAccounts: defaultExpoAccounts(),
    expoProjects: defaultExpoProjects(),
    addSshTarget: jest.fn(),
    updateSshTarget: jest.fn(),
    removeSshTarget: jest.fn(),
    addWorkspaceTarget: jest.fn(),
    updateWorkspaceTarget: jest.fn(),
    removeWorkspaceTarget: jest.fn(),
    addBrowserProvider: jest.fn(),
    updateBrowserProvider: jest.fn(),
    removeBrowserProvider: jest.fn(),
    addExpoAccount: jest.fn(),
    updateExpoAccount: jest.fn(),
    removeExpoAccount: jest.fn(),
    addExpoProject: jest.fn(),
    updateExpoProject: jest.fn(),
    removeExpoProject: jest.fn(),
    addMcpServer: jest.fn(),
    updateMcpServer: jest.fn(),
    removeMcpServer: jest.fn(),
  };

  return {
    useSettingsStore: Object.assign((selector: (innerState: any) => any) => selector(state), {
      getState: () => state,
    }),
  };
});

jest.mock('../../src/services/browser/providers', () => ({
  BROWSER_PROVIDER_OPTIONS: ['browserbase', 'browserless', 'custom'],
  BROWSER_PROVIDER_AUTH_OPTIONS: ['none', 'api-key-header', 'bearer', 'query-token'],
  BROWSER_PROVIDER_PRESETS: [{ id: 'browserbase-default', label: 'Browserbase' }],
  applyBrowserProviderPreset: (config: any) => config,
  getBrowserProviderAuthHint: () => 'Auth hint',
  getBrowserProviderAuthLabel: (authMode: string) => authMode,
  isValidBrowserProviderBaseUrl: () => true,
  getBrowserProviderLabel: () => 'Browserbase',
  getBrowserProviderReadiness: () => ({ launchable: true, reason: 'ready' }),
  probeBrowserProvider: (...args: any[]) => mockProbeBrowserProvider(...args),
}));

jest.mock('../../src/services/browser/jobs', () => ({
  launchBrowserLiveSession: (...args: any[]) => mockLaunchBrowserLiveSession(...args),
  stopBrowserLiveSession: (...args: any[]) => mockStopBrowserLiveSession(...args),
}));

jest.mock('../../src/services/workspaces/connector', () => ({
  WORKSPACE_PROVIDER_OPTIONS: [
    'code-server',
    'openvscode-server',
    'cursor',
    'windsurf',
    'generic-vscode',
    'custom',
  ],
  WORKSPACE_AUTH_MODE_OPTIONS: ['none', 'bearer', 'query-token'],
  isValidWorkspaceBaseUrl: () => true,
  getWorkspaceProviderLabel: () => 'code-server',
  getWorkspaceProviderFileAccessMode: () => 'native',
  supportsWorkspaceFileAccess: () => true,
  supportsWorkspaceBrowserAutomation: () => true,
  supportsWorkspaceAiTaskDelegation: () => true,
  getWorkspaceTargetReadiness: (target: any) => ({
    launchable: Boolean(target.baseUrl),
    reason: target.baseUrl ? 'ready' : 'missing-base-url',
  }),
  resolveWorkspaceTargetLaunch: (...args: any[]) => mockResolveWorkspaceTargetLaunch(...args),
  probeWorkspaceTarget: (...args: any[]) => mockProbeWorkspaceTarget(...args),
}));

jest.mock('../../src/services/workspaces/control', () => ({
  getWorkspaceTargetControlStatus: (...args: any[]) => mockGetWorkspaceTargetControlStatus(...args),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  SSH_HOST_KEY_POLICY_OPTIONS: ['trust-on-first-use', 'strict'],
  getSshHostFingerprint: jest.fn(),
  getSshHostKeyPolicyLabel: () => 'Trust on first use',
  getSshTargetAuthModeLabel: () => 'Password',
  getSshTargetLabel: () => 'developer@ssh.example.com:22',
  getSshTargetReadiness: () => ({ launchable: true, reason: 'ready' }),
  probeSshTarget: (...args: any[]) => mockProbeSshTarget(...args),
}));

jest.mock('../../src/services/ssh/native', () => ({
  SSH_AUTH_MODE_OPTIONS: [
    { value: 'password', labelKey: 'settings.sshAuthPassword' },
    { value: 'private-key', labelKey: 'settings.sshAuthPrivateKey' },
  ],
}));

jest.mock('../../src/services/remote/store', () => ({
  useRemoteStore: Object.assign(
    (selector: (state: any) => any) => selector({ jobs: {}, sessions: {} }),
    { getState: () => ({ jobs: {}, sessions: {} }) },
  ),
}));

jest.mock('../../src/services/ssh/sessionStore', () => ({
  useSshSessionStore: (selector: (state: any) => any) =>
    selector({
      sessions: {
        'ssh-session-1': {
          id: 'ssh-session-1',
          targetId: 'ssh-1',
          targetName: 'Build box',
          targetLabel: 'developer@ssh.example.com:22',
          status: 'connected',
          transcript: '$ pwd\n/home/user\n',
        },
      },
      openShellSession: (...args: any[]) => mockOpenShellSession(...args),
      writeShellInput: (...args: any[]) => mockWriteShellInput(...args),
      sendShellCommand: jest.fn(),
      closeShellSession: (...args: any[]) => mockCloseShellSession(...args),
    }),
}));

jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    getAllStatuses: () => [
      {
        id: 'mcp-1',
        name: 'Tool Server',
        state: 'connected',
        tools: [{ name: 'tool-a' }],
        lastConnected: Date.now(),
      },
    ],
    subscribe: () => () => undefined,
  },
}));

jest.mock('../../src/services/expo/eas', () => ({
  getExpoProjectExecutionMode: (project: any) => project.mode || 'eas-workflow',
  getExpoProjectDisplayOwner: (project: any, account: any) =>
    project.owner || account?.owner || 'owner',
  getExpoProjectReadiness: () => ({ launchable: true, reason: 'ready' }),
  getExpoProjectReadinessLabel: () => 'Ready',
  probeExpoProject: (...args: any[]) => mockProbeExpoProject(...args),
  runExpoProjectAction: (...args: any[]) => mockRunExpoProjectAction(...args),
  syncExpoAccountProjects: (...args: any[]) => mockSyncExpoAccountProjects(...args),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
  saveSecure: jest.fn().mockResolvedValue(undefined),
  deleteSecure: jest.fn().mockResolvedValue(undefined),
}));

describe('RemoteWorkScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSettingsState();
    mockInteractiveTerminalProps = null;
    mockGetSecure.mockImplementation(() => new Promise(() => {}));
    mockResolveWorkspaceTargetLaunch.mockResolvedValue({
      uri: 'https://code.example.com/?folder=%2Fworkspace%2Frepo',
    });
    mockProbeWorkspaceTarget.mockResolvedValue({
      ok: true,
      message: 'Ready (200)',
      checkedAt: Date.now(),
    });
    mockProbeSshTarget.mockResolvedValue({
      ok: true,
      message: 'Connected · /home/user',
      checkedAt: Date.now(),
    });
    mockProbeBrowserProvider.mockResolvedValue({
      ok: true,
      message: 'Ready (200)',
      checkedAt: Date.now(),
    });
    mockLaunchBrowserLiveSession.mockResolvedValue('remote-session-1');
    mockOpenShellSession.mockResolvedValue('ssh-session-1');
    mockProbeExpoProject.mockResolvedValue({
      ok: true,
      message: 'EAS CLI ready',
      checkedAt: Date.now(),
    });
    mockRunExpoProjectAction.mockResolvedValue({ mode: 'direct-ssh', output: 'ok' });
    mockSyncExpoAccountProjects.mockResolvedValue({
      accountId: 'expo-account-1',
      syncedAt: Date.now(),
      projectCount: 1,
      projects: [],
    });
    mockGetWorkspaceTargetControlStatus.mockImplementation((target: any, settings?: any) => {
      const launchable = Boolean(target.enabled !== false && target.baseUrl);
      const browserProviderAvailable = Boolean(
        target.browserProviderId &&
        settings?.browserProviders?.some(
          (provider: any) => provider.id === target.browserProviderId && provider.enabled,
        ),
      );
      const sshTargetAvailable = Boolean(
        target.sshTargetId &&
        settings?.sshTargets?.some(
          (sshTarget: any) => sshTarget.id === target.sshTargetId && sshTarget.enabled,
        ),
      );
      const aiTaskReady = Boolean(
        target.enabled !== false &&
        target.rootPath &&
        sshTargetAvailable &&
        (target.provider === 'cursor' || target.aiTaskCommandTemplate),
      );

      return {
        id: target.id,
        name: target.name,
        provider: target.provider || 'code-server',
        providerLabel: target.provider || 'code-server',
        launchable,
        launchReason: launchable
          ? 'ready'
          : target.enabled === false
            ? 'disabled'
            : 'missing-base-url',
        fileAccessMode: 'native',
        fileAccessReady: launchable,
        browserAutomationReady: launchable && browserProviderAvailable,
        browserProviderId: browserProviderAvailable ? target.browserProviderId : undefined,
        sshTargetId: sshTargetAvailable ? target.sshTargetId : undefined,
        aiTaskReady,
        aiTaskCommandSource: aiTaskReady
          ? target.provider === 'cursor'
            ? 'cursor-default'
            : 'custom-template'
          : undefined,
        summary: aiTaskReady
          ? 'Ready for AI handoff via linked SSH target.'
          : launchable
            ? 'Ready for launch.'
            : target.enabled === false
              ? 'Workspace target is disabled.'
              : 'No ready remote control path is configured for this workspace target.',
      };
    });
  });

  it('renders the remote work dashboard', () => {
    const { getByText, getAllByText } = render(<RemoteWorkScreen />);
    expect(getByText('Remote Work')).toBeTruthy();
    expect(getAllByText('Workspace targets').length).toBeGreaterThan(0);
    expect(getAllByText('Main Repo').length).toBeGreaterThan(0);
    expect(getAllByText('SSH targets').length).toBeGreaterThan(0);
    expect(getAllByText('Build box').length).toBeGreaterThan(0);
    expect(getAllByText('Browser providers').length).toBeGreaterThan(0);
    expect(getAllByText('Primary Browserbase').length).toBeGreaterThan(0);
    expect(getAllByText('Expo / EAS').length).toBeGreaterThan(0);
    expect(getAllByText('Kavi').length).toBeGreaterThan(0);
  });

  it('runs an Expo build action', async () => {
    const { getByText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByText('Build Android'));

    await waitFor(() => {
      expect(mockRunExpoProjectAction).toHaveBeenCalledWith('expo-project-1', 'build', {
        platform: 'android',
      });
    });
  });

  it('runs iOS build and submit actions for Expo projects', async () => {
    const { getByText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByText('Build iOS'));
    fireEvent.press(getByText('Submit iOS'));

    await waitFor(() => {
      expect(mockRunExpoProjectAction).toHaveBeenCalledWith('expo-project-1', 'build', {
        platform: 'ios',
      });
      expect(mockRunExpoProjectAction).toHaveBeenCalledWith('expo-project-1', 'submit', {
        platform: 'ios',
      });
    });
  });

  it('launches a workspace into the WebView session modal', async () => {
    const { getByText, getByTestId } = render(<RemoteWorkScreen />);
    fireEvent.press(getByText('Launch Workspace'));

    await waitFor(() => {
      expect(mockResolveWorkspaceTargetLaunch).toHaveBeenCalled();
      expect(getByTestId('remote-workspace-webview')).toBeTruthy();
    });
  });

  it('runs a connection probe and renders the result', async () => {
    const { getAllByText, findAllByText } = render(<RemoteWorkScreen />);
    fireEvent.press(getAllByText('Check connection')[0]);
    expect((await findAllByText('Ready (200)')).length).toBeGreaterThan(0);
  });

  it('opens an SSH shell session modal', async () => {
    const { findByTestId, getByText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByText('Resume Shell'));

    expect(await findByTestId('mock-interactive-terminal-surface')).toBeTruthy();

    mockInteractiveTerminalProps.onReady?.(80, 24);

    await waitFor(() => {
      expect(mockTerminalRef.write).toHaveBeenCalledWith('$ pwd\n/home/user\n');
    });
  });

  it('forwards raw terminal input to the active SSH session', async () => {
    const { findByTestId, getByText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByText('Resume Shell'));
    expect(await findByTestId('mock-interactive-terminal-surface')).toBeTruthy();

    await waitFor(() => {
      expect(mockInteractiveTerminalProps).toBeTruthy();
    });

    await mockInteractiveTerminalProps.onInput?.('l');

    expect(mockWriteShellInput).toHaveBeenCalledWith('ssh-session-1', 'l');
  });

  it('navigates to settings from the header action', () => {
    const { getByLabelText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByLabelText('Open Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });

  it('shows all five configuration studio surfaces', () => {
    const { getByLabelText } = render(<RemoteWorkScreen />);
    expect(getByLabelText('Ready workspaces')).toBeTruthy();
    expect(getByLabelText('SSH targets')).toBeTruthy();
    expect(getByLabelText('Browser providers')).toBeTruthy();
    expect(getByLabelText('Expo / EAS')).toBeTruthy();
    expect(getByLabelText('MCP servers')).toBeTruthy();
  });

  it('switches to the Expo surface and opens the explicit editor', async () => {
    const { findByText, getByLabelText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByLabelText('Expo / EAS'));
    fireEvent.press(getByLabelText('Add Expo project'));

    expect(await findByText('Expo Accounts')).toBeTruthy();
    expect(await findByText('Expo Projects')).toBeTruthy();
  });

  it('shows the richer Expo project fields used in Settings', async () => {
    const { findByText, getByLabelText, getByText, queryByText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(getByText('GitHub Workflow'));

    expect(await findByText('Workflow Ref')).toBeTruthy();
    expect(getByText('Update Channel')).toBeTruthy();
    expect(getByText('Preview URL')).toBeTruthy();
    expect(getByText('Custom Domain')).toBeTruthy();
    expect(queryByText('Robot / CI')).toBeTruthy();
  });

  it('syncs Expo projects from the Remote Work editor', async () => {
    const { getAllByLabelText, getByLabelText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(getAllByLabelText('Refresh')[0]);

    await waitFor(() => {
      expect(mockSyncExpoAccountProjects).toHaveBeenCalledWith('expo-account-1');
    });
  });

  it('switches to the MCP surface and opens the explicit editor', async () => {
    const { findByPlaceholderText, getByLabelText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByLabelText('MCP servers'));
    fireEvent.press(getByLabelText('Add MCP server'));

    expect(await findByPlaceholderText('Server name')).toBeTruthy();
  });

  it('has Edit buttons on MCP target cards', () => {
    const { getByLabelText } = render(<RemoteWorkScreen />);
    expect(getByLabelText('Edit MCP Server')).toBeTruthy();
  });

  it('has Edit buttons on Expo project cards', () => {
    const { getByLabelText } = render(<RemoteWorkScreen />);
    expect(getByLabelText('Edit Expo Project')).toBeTruthy();
  });

  it('opens an explicit workspace editor modal when editing a target', async () => {
    const { findByText, getAllByLabelText } = render(<RemoteWorkScreen />);

    fireEvent.press(getAllByLabelText('Edit Workspace Target')[0]);

    expect(await findByText('Edit workspace target: Main Repo')).toBeTruthy();
    expect(await findByText('Basics')).toBeTruthy();
  });

  it('loads the stored workspace access token when editing an existing target', async () => {
    const settingsState = getSettingsState();
    settingsState.workspaceTargets = [
      {
        ...settingsState.workspaceTargets[0],
        authMode: 'bearer',
        accessTokenRef: 'workspace_access_token_ws-1',
      },
    ];
    mockGetSecure.mockImplementation(async (key: string) => {
      if (key === 'workspace_access_token_ws-1') {
        return 'workspace-secret';
      }
      return '';
    });

    const { findByDisplayValue, getAllByLabelText } = render(<RemoteWorkScreen />);

    fireEvent.press(getAllByLabelText('Edit Workspace Target')[0]);

    await waitFor(() => {
      expect(mockGetSecure).toHaveBeenCalledWith('workspace_access_token_ws-1');
    });
    expect(await findByDisplayValue('workspace-secret')).toBeTruthy();
  });

  it('saves a new workspace target with a bearer token', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    const { findByPlaceholderText, getAllByLabelText, getByLabelText, getByText } = render(
      <RemoteWorkScreen />,
    );

    fireEvent.press(getAllByLabelText('Add Workspace Target')[0]);
    fireEvent.changeText(await findByPlaceholderText('/Users/username/project'), '/workspace/app');
    fireEvent.changeText(
      await findByPlaceholderText('https://code.example.com'),
      'https://code.internal',
    );
    fireEvent.press(getByText('Bearer token'));
    fireEvent.changeText(await findByPlaceholderText('workspace token'), 'workspace-secret');
    fireEvent.press(getByLabelText('Save workspace target'));

    await waitFor(() => {
      expect(storage.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('workspace_access_token_'),
        'workspace-secret',
      );
      expect(settingsState.addWorkspaceTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          rootPath: '/workspace/app',
          baseUrl: 'https://code.internal',
          authMode: 'bearer',
          accessTokenRef: expect.stringContaining('workspace_access_token_'),
        }),
      );
    });
  });

  it('executes delete workspace confirmation from the config studio', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    confirmDestructiveAlert();

    const { findByText, getAllByLabelText, getByLabelText } = render(<RemoteWorkScreen />);
    fireEvent.press(getAllByLabelText('Edit Workspace Target')[0]);
    expect(await findByText('Edit workspace target: Main Repo')).toBeTruthy();
    fireEvent.press(getByLabelText('Delete Workspace Target'));

    await waitFor(() => {
      expect(settingsState.removeWorkspaceTarget).toHaveBeenCalledWith('ws-1');
      expect(storage.deleteSecure).toHaveBeenCalledWith('workspace_access_token_ws-1');
    });
  });

  it('saves a new SSH target with private-key authentication', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    const { findByPlaceholderText, getByLabelText, getByText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('SSH targets'));
    fireEvent.press(getByLabelText('Add SSH target'));
    fireEvent.changeText(await findByPlaceholderText('ssh.example.com'), 'ssh.internal');
    fireEvent.changeText(await findByPlaceholderText('developer'), 'deploy');
    fireEvent.press(getByText('Private key'));
    fireEvent.changeText(
      await findByPlaceholderText('-----BEGIN OPENSSH PRIVATE KEY-----'),
      'PRIVATE KEY',
    );
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(storage.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('ssh_private_key_'),
        'PRIVATE KEY',
      );
      expect(settingsState.addSshTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'ssh.internal',
          username: 'deploy',
          authMode: 'private-key',
          privateKeyRef: expect.stringContaining('ssh_private_key_'),
        }),
      );
    });
  });

  it('saves a new browser provider with a stored token', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    const { findByPlaceholderText, getByLabelText, getByText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('Browser providers'));
    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.changeText(await findByPlaceholderText('bb_project_123'), 'proj_live');
    fireEvent.changeText(await findByPlaceholderText('browser provider key'), 'browser-token');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(storage.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('browser_provider_api_key_'),
        'browser-token',
      );
      expect(settingsState.addBrowserProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj_live',
          authMode: 'api-key-header',
          apiKeyRef: expect.stringContaining('browser_provider_api_key_'),
        }),
      );
    });
  });

  it('loads the stored browser API key when editing an existing provider', async () => {
    mockGetSecure.mockImplementation(async (key: string) => {
      if (key === 'browser_provider_api_key_browser-1') {
        return 'browser-secret';
      }
      return '';
    });

    const { findByDisplayValue, getByLabelText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('Edit Browser Provider'));

    await waitFor(() => {
      expect(mockGetSecure).toHaveBeenCalledWith('browser_provider_api_key_browser-1');
    });
    expect(await findByDisplayValue('browser-secret')).toBeTruthy();
  });

  it('saves a new Expo account and syncs its projects', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    const {
      findByPlaceholderText,
      findByText,
      getAllByPlaceholderText,
      getAllByText,
      getByLabelText,
      getByPlaceholderText,
    } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(await findByText('Add Expo account'));
    fireEvent.changeText(getByPlaceholderText('Expo Production'), 'CI Account');
    fireEvent.changeText(getAllByPlaceholderText('my-org')[0], 'kavi-ci');
    fireEvent.changeText(await findByPlaceholderText('eas_xxx'), 'eas_token');
    fireEvent.press(getAllByText('Save')[0]);

    await waitFor(() => {
      expect(storage.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('expo_account_token_'),
        'eas_token',
      );
      expect(settingsState.addExpoAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'CI Account',
          owner: 'kavi-ci',
          tokenRef: expect.stringContaining('expo_account_token_'),
        }),
      );
      expect(mockSyncExpoAccountProjects).toHaveBeenCalled();
    });
  });

  it('saves a new Expo project in GitHub workflow mode', async () => {
    const settingsState = getSettingsState();
    const { findByPlaceholderText, getAllByText, getByLabelText, getByText } = render(
      <RemoteWorkScreen />,
    );

    fireEvent.press(getByLabelText('Expo / EAS'));
    fireEvent.press(getByLabelText('Add Expo project'));
    fireEvent.press(getByText('GitHub Workflow'));
    fireEvent.changeText(await findByPlaceholderText('Mobile App'), 'Kavi Next');
    fireEvent.changeText(await findByPlaceholderText('kavi'), 'kavi-app-next');
    fireEvent.changeText(await findByPlaceholderText('owner/repo'), 'kavi/mobile');
    fireEvent.changeText(
      await findByPlaceholderText('.github/workflows/eas.yml'),
      '.github/workflows/eas.yml',
    );
    fireEvent.press(getAllByText('Save')[1]);

    await waitFor(() => {
      expect(settingsState.addExpoProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Kavi Next',
          slug: 'kavi-app-next',
          mode: 'github-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.github/workflows/eas.yml',
        }),
      );
    });
  });

  it('executes delete Expo project confirmation from the config studio', async () => {
    const settingsState = getSettingsState();
    confirmDestructiveAlert();

    const { getByLabelText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(getByLabelText('Delete Expo Project'));

    await waitFor(() => {
      expect(settingsState.removeExpoProject).toHaveBeenCalledWith('expo-project-1');
    });
  });

  it('saves a new MCP server with a stored auth token', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    const { findByPlaceholderText, getByLabelText, getByText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('MCP servers'));
    fireEvent.press(getByLabelText('Add MCP server'));
    fireEvent.changeText(await findByPlaceholderText('Server name'), 'Deploy Tools');
    fireEvent.changeText(
      await findByPlaceholderText('https://mcp-server.example.com'),
      'https://mcp.internal/sse',
    );
    fireEvent.changeText(await findByPlaceholderText('Bearer token'), 'mcp-token');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(storage.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('mcp_server_token_'),
        'mcp-token',
      );
      expect(settingsState.addMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Deploy Tools',
          url: 'https://mcp.internal/sse',
          tokenRef: expect.stringContaining('mcp_server_token_'),
        }),
      );
    });
  });

  it('executes delete MCP server confirmation from the config studio', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    confirmDestructiveAlert();

    const { getByLabelText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByLabelText('Edit MCP Server'));
    fireEvent.press(getByLabelText('Delete MCP Server'));

    await waitFor(() => {
      expect(settingsState.removeMcpServer).toHaveBeenCalledWith('mcp-1');
      expect(storage.deleteSecure).toHaveBeenCalledWith('mcp_server_token_mcp-1');
    });
  });

  it('requires a workspace root path before saving', async () => {
    const settingsState = getSettingsState();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getAllByLabelText, getByLabelText } = render(<RemoteWorkScreen />);

    fireEvent.press(getAllByLabelText('Add Workspace Target')[0]);
    fireEvent.press(getByLabelText('Save workspace target'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addWorkspaceTarget).not.toHaveBeenCalled();
  });

  it('does not treat disabled linked workspaces as ready', () => {
    const state = getSettingsState();
    state.workspaceTargets = [
      {
        id: 'ws-disabled',
        name: 'Dormant Cursor',
        rootPath: '/workspace/repo',
        provider: 'cursor',
        sshTargetId: 'ssh-1',
        aiTaskCommandTemplate: 'agent -p {{prompt}}',
        enabled: false,
      },
    ];

    const { getByText, queryByText } = render(<RemoteWorkScreen />);

    expect(getByText('0 ready')).toBeTruthy();
    expect(getByText('1 disabled')).toBeTruthy();
    expect(queryByText('AI handoff ready')).toBeNull();
  });

  it('does not surface stale linked browser or SSH ids in the workspace detail card', () => {
    const state = getSettingsState();
    state.workspaceTargets = [
      {
        id: 'ws-stale',
        name: 'Cursor Repo',
        rootPath: '/workspace/repo',
        provider: 'cursor',
        browserProviderId: 'missing-browser',
        sshTargetId: 'missing-ssh',
        enabled: true,
      },
    ];

    const { getAllByText, getByText, queryByText } = render(<RemoteWorkScreen />);

    expect(getAllByText('None').length).toBeGreaterThan(0);
    expect(getByText('Link an SSH target to enable Cursor CLI handoff')).toBeTruthy();
    expect(queryByText('missing-browser')).toBeNull();
    expect(queryByText('missing-ssh')).toBeNull();
  });

  it('falls back to the workspace root name when a saved target has no display name', () => {
    const state = getSettingsState();
    state.workspaceTargets = [
      {
        id: 'ws-blank-name',
        name: '   ',
        rootPath: '/workspace/nested/repo-name',
        baseUrl: 'https://code.example.com',
        provider: 'code-server',
        enabled: true,
      },
    ];

    const { getAllByText } = render(<RemoteWorkScreen />);

    expect(getAllByText('repo-name').length).toBeGreaterThan(0);
  });

  it('requires an SSH host before saving', async () => {
    const settingsState = getSettingsState();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('SSH targets'));
    fireEvent.press(getByLabelText('Add SSH target'));
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addSshTarget).not.toHaveBeenCalled();
  });

  it('requires a Browserbase project id before saving a browser provider', async () => {
    const settingsState = getSettingsState();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('Browser providers'));
    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addBrowserProvider).not.toHaveBeenCalled();
  });

  it('executes delete browser provider confirmation from the config studio', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    confirmDestructiveAlert();

    const { getByLabelText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByLabelText('Edit Browser Provider'));
    fireEvent.press(getByLabelText('Delete Browser Provider'));

    await waitFor(() => {
      expect(settingsState.removeBrowserProvider).toHaveBeenCalledWith('browser-1');
      expect(storage.deleteSecure).toHaveBeenCalledWith('browser_provider_api_key_browser-1');
    });
  });

  it('requires an Expo account owner before saving', async () => {
    const settingsState = getSettingsState();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { findByText, getAllByText, getByLabelText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(await findByText('Add Expo account'));
    fireEvent.press(getAllByText('Save')[0]);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addExpoAccount).not.toHaveBeenCalled();
  });

  it('executes delete Expo account confirmation from the config studio', async () => {
    const settingsState = getSettingsState();
    const storage = getSecureStorageMocks();
    confirmDestructiveAlert();

    const { getByLabelText } = render(<RemoteWorkScreen />);
    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(getByLabelText('Delete Expo Account'));

    await waitFor(() => {
      expect(settingsState.removeExpoAccount).toHaveBeenCalledWith('expo-account-1');
      expect(storage.deleteSecure).toHaveBeenCalledWith('expo_account_token_expo-account-1');
    });
  });

  it('requires a workflow file for GitHub workflow Expo projects', async () => {
    const settingsState = getSettingsState();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { findByPlaceholderText, getAllByText, getByLabelText, getByText } = render(
      <RemoteWorkScreen />,
    );

    fireEvent.press(getByLabelText('Expo / EAS'));
    fireEvent.press(getByLabelText('Add Expo project'));
    fireEvent.press(getByText('GitHub Workflow'));
    fireEvent.changeText(await findByPlaceholderText('kavi'), 'kavi-app-next');
    fireEvent.changeText(await findByPlaceholderText('owner/repo'), 'kavi/mobile');
    fireEvent.press(getAllByText('Save')[1]);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addExpoProject).not.toHaveBeenCalled();
  });

  it('requires an MCP server URL before saving', async () => {
    const settingsState = getSettingsState();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { findByPlaceholderText, getByLabelText, getByText } = render(<RemoteWorkScreen />);

    fireEvent.press(getByLabelText('MCP servers'));
    fireEvent.press(getByLabelText('Add MCP server'));
    fireEvent.changeText(await findByPlaceholderText('Server name'), 'Deploy Tools');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Server URL is required.');
    });
    expect(settingsState.addMcpServer).not.toHaveBeenCalled();
  });
});
