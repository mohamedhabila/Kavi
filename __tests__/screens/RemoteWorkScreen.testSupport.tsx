import { render } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { RemoteWorkScreen } from '../../src/screens/RemoteWorkScreen';

export const mockGoBack = jest.fn();
export const mockNavigate = jest.fn();
export const mockResolveWorkspaceTargetLaunch = jest.fn();
export const mockProbeWorkspaceTarget = jest.fn();
export const mockGetWorkspaceTargetControlStatus = jest.fn();
export const mockProbeSshTarget = jest.fn();
export const mockProbeBrowserProvider = jest.fn();
export const mockLaunchBrowserLiveSession = jest.fn();
export const mockStopBrowserLiveSession = jest.fn();
export const mockOpenShellSession = jest.fn();
export const mockWriteShellInput = jest.fn();
export const mockCloseShellSession = jest.fn();
export const mockProbeExpoProject = jest.fn();
export const mockRunExpoProjectAction = jest.fn();
export const mockSyncExpoAccountProjects = jest.fn();
export const mockGetSecure = jest.fn();
export const mockGetMcpOAuthClientSecret = jest.fn();
export const mockSaveMcpOAuthClientSecret = jest.fn();
export const mockDeleteMcpOAuthClientSecret = jest.fn();
export const mockHasStoredMcpOAuth = jest.fn();
export const mockClearMcpOAuth = jest.fn();
export const mockTerminalRef = {
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

export const remoteWorkTestState: { interactiveTerminalProps: any } = {
  interactiveTerminalProps: null,
};

const getSettingsState = () =>
  require('../../src/store/useSettingsStore').useSettingsStore.getState();
const getRemoteConfigCollectionState = () => require('../helpers/remoteConfigCollectionState');

function createRemoteWorkTestCollections() {
  return getRemoteConfigCollectionState().createDefaultRemoteConfigCollections();
}

function resetSettingsState() {
  const state = getSettingsState();
  getRemoteConfigCollectionState().assignRemoteConfigCollections(
    state,
    createRemoteWorkTestCollections(),
  );
}

export const getRemoteWorkSettingsState = () => getSettingsState();
export const getRemoteWorkSecureStorageMocks = () =>
  require('../../src/services/storage/SecureStorage');
export const getInteractiveTerminalProps = () => remoteWorkTestState.interactiveTerminalProps;
export const renderRemoteWorkScreen = () => render(<RemoteWorkScreen />);
export const confirmRemoteWorkDestructiveAlert = () =>
  require('../helpers/remoteConfigFixtures').confirmDestructiveAlert();

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
    remoteWorkTestState.interactiveTerminalProps = props;
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
  const {
    createDefaultRemoteConfigCollections,
  } = require('../helpers/remoteConfigCollectionState');
  const collections = createDefaultRemoteConfigCollections();
  const state = {
    workspaceTargets: collections.workspaceTargets,
    defaultWorkspaceTargetId: collections.workspaceTargets[0]?.id ?? null,
    sshTargets: collections.sshTargets,
    browserProviders: collections.browserProviders,
    mcpServers: collections.mcpServers,
    expoAccounts: collections.expoAccounts,
    expoProjects: collections.expoProjects,
    addSshTarget: jest.fn(),
    updateSshTarget: jest.fn(),
    removeSshTarget: jest.fn(),
    addWorkspaceTarget: jest.fn(),
    updateWorkspaceTarget: jest.fn(),
    removeWorkspaceTarget: jest.fn(),
    setDefaultWorkspaceTargetId: jest.fn(),
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

jest.mock('../../src/services/browser/providers/registry', () => ({
  BROWSER_PROVIDER_OPTIONS: ['browserbase', 'browserless', 'custom'],
  BROWSER_PROVIDER_AUTH_OPTIONS: ['none', 'api-key-header', 'bearer', 'query-token'],
  BROWSER_PROVIDER_PRESETS: [{ id: 'browserbase-default', label: 'Browserbase' }],
  applyBrowserProviderPreset: (config: any) => config,
  isValidBrowserProviderBaseUrl: () => true,
}));

jest.mock('../../src/services/browser/providers/readiness', () => ({
  getBrowserProviderReadiness: () => ({ launchable: true, reason: 'ready' }),
}));

jest.mock('../../src/services/browser/providers/probe', () => ({
  probeBrowserProvider: (...args: any[]) => mockProbeBrowserProvider(...args),
}));

jest.mock('../../src/services/browser/providers/labels', () => ({
  getBrowserProviderAuthHint: () => 'Auth hint',
  getBrowserProviderAuthLabel: (authMode: string) => authMode,
  getBrowserProviderLabel: () => 'Browserbase',
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

jest.mock('../../src/services/expo/projectState', () => ({
  getExpoProjectDisplayOwner: (project: any, account: any) =>
    project.owner || account?.owner || 'owner',
}));

jest.mock('../../src/services/expo/projectAutomation', () => ({
  getExpoProjectExecutionMode: (project: any) => project.mode || 'eas-workflow',
  getExpoProjectReadiness: () => ({ launchable: true, reason: 'ready' }),
  getExpoProjectReadinessLabel: () => 'Ready',
}));

jest.mock('../../src/services/expo/workflowActions', () => ({
  probeExpoProject: (...args: any[]) => mockProbeExpoProject(...args),
  runExpoProjectAction: (...args: any[]) => mockRunExpoProjectAction(...args),
}));

jest.mock('../../src/services/expo/projectSync', () => ({
  syncExpoAccountProjects: (...args: any[]) => mockSyncExpoAccountProjects(...args),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
  getMcpOAuthClientSecret: (...args: any[]) => mockGetMcpOAuthClientSecret(...args),
  saveMcpOAuthClientSecret: (...args: any[]) => mockSaveMcpOAuthClientSecret(...args),
  deleteMcpOAuthClientSecret: (...args: any[]) => mockDeleteMcpOAuthClientSecret(...args),
  saveSecure: jest.fn().mockResolvedValue(undefined),
  deleteSecure: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/mcp/oauth', () => ({
  hasStoredMcpOAuth: (...args: any[]) => mockHasStoredMcpOAuth(...args),
  clearMcpOAuth: (...args: any[]) => mockClearMcpOAuth(...args),
}));

export const setupRemoteWorkScreenTestSuite = () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSettingsState();
    remoteWorkTestState.interactiveTerminalProps = null;
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
    mockGetMcpOAuthClientSecret.mockResolvedValue('');
    mockSaveMcpOAuthClientSecret.mockResolvedValue(undefined);
    mockDeleteMcpOAuthClientSecret.mockResolvedValue(undefined);
    mockHasStoredMcpOAuth.mockResolvedValue(false);
    mockClearMcpOAuth.mockResolvedValue(undefined);
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
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
};
