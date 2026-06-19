import { render } from '@testing-library/react-native';

import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { createEmptyRemoteConfigCollections } from '../helpers/remoteConfigCollectionState';
import { createMcpServer } from '../helpers/remoteConfigFixtures';

jest.mock('../../src/engine/tools/definitions', () => ({
  TOOL_DEFINITIONS: [
    {
      name: 'web_search',
      description: 'Search the web',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

const mockSettings = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  addProvider: jest.fn(),
  updateProvider: jest.fn(),
  removeProvider: jest.fn(),
  addMcpServer: jest.fn(),
  updateMcpServer: jest.fn(),
  removeMcpServer: jest.fn(),
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
  setTheme: jest.fn(),
  setSystemPrompt: jest.fn(),
  setThinkingLevel: jest.fn(),
  setLocale: jest.fn(),
  i18nSetLocale: jest.fn().mockResolvedValue(undefined),
  setWebSearchProvider: jest.fn(),
  clearAllConversations: jest.fn(),
  getSecure: jest.fn().mockResolvedValue(''),
  saveSecure: jest.fn().mockResolvedValue(undefined),
  deleteSecure: jest.fn().mockResolvedValue(undefined),
  installLocalLlmModel: jest.fn(),
  getLocalLlmAvailability: jest.fn(),
  syncExpoAccountProjects: jest.fn().mockResolvedValue({
    accountId: 'expo-account-1',
    syncedAt: Date.now(),
    projectCount: 1,
    projects: [],
  }),
  setPermission: jest.fn(),
  setPersonaOverride: jest.fn(),
  upsertCustomPersona: jest.fn(),
};

const createSettingsRemoteConfigCollections = () =>
  createEmptyRemoteConfigCollections({
    mcpServers: [
      createMcpServer({
        id: 'mcp1',
        name: 'Test MCP',
        url: 'https://mcp.test.com',
      }),
    ],
  });

const mockSettingsState = {
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-5.4',
      enabled: true,
    },
  ],
  ...createSettingsRemoteConfigCollections(),
};

const mockConsoleError = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
  const firstArg = args[0];
  if (typeof firstArg === 'string' && firstArg.includes('not wrapped in act')) {
    return;
  }
});

const mockPersonaStoreState = {
  overrides: {},
  customPersonas: [],
  setOverride: mockSettings.setPersonaOverride,
  upsertCustomPersona: mockSettings.upsertCustomPersona,
};

const mockAvailablePersonas = [
  {
    id: 'default',
    name: 'Assistant',
    description: 'General-purpose helpful AI assistant',
    systemPrompt: 'You are the assistant system prompt.',
  },
  {
    id: 'coder',
    name: 'Coder',
    description: 'Programming and software development expert',
    systemPrompt: 'You are the coder system prompt.',
    thinkingLevel: 'high',
  },
];

const mockPermissionStoreState = {
  permissions: [],
  setPermission: mockSettings.setPermission,
};

const buildInstalledLocalProvider = (provider: any) => {
  const { File } = require('expo-file-system');
  const { getLocalLlmCatalogEntry } = require('../../src/services/localLlm/catalog');
  const catalogEntry = getLocalLlmCatalogEntry(provider.model);
  const localPath = `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || provider.model}`;
  new File(localPath).write('downloaded');
  (jest.requireMock('expo-file-system') as any).__setFileSize?.(
    localPath,
    catalogEntry?.sizeBytes || 1,
  );
  return {
    ...provider,
    local: {
      ...provider.local,
      installedModels: [
        {
          modelId: provider.model,
          fileName: catalogEntry?.fileName || provider.model,
          localPath,
          installedAt: 1,
          sizeBytes: catalogEntry?.sizeBytes || 1,
          sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
        },
      ],
    },
  };
};

export const settingsMocks = mockSettings;
export const settingsTestState = mockSettingsState;
export const renderSettingsScreen = () => render(<SettingsScreen />);
export const confirmSettingsDestructiveAlert = () =>
  require('../helpers/remoteConfigFixtures').confirmDestructiveAlert();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockSettings.goBack,
    navigate: mockSettings.navigate,
    openDrawer: jest.fn(),
    closeDrawer: jest.fn(),
  }),
  useRoute: () => ({ name: 'Settings', params: {} }),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      header: '#111',
      panel: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      dangerSoft: '#300',
      success: '#0d0',
      overlay: 'rgba(0,0,0,0.5)',
    },
  }),
  AppPalette: {},
  ThemePreference: {},
}));

jest.mock('../../src/i18n/manager', () => {
  const actual = jest.requireActual('../../src/i18n/manager');
  actual.i18n.setLocale = (...args: any[]) => mockSettings.i18nSetLocale(...args);
  return {
    ...actual,
    i18n: actual.i18n,
  };
});

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: any) => any) => {
    const state = {
      providers: mockSettingsState.providers,
      mcpServers: mockSettingsState.mcpServers,
      sshTargets: mockSettingsState.sshTargets,
      workspaceTargets: mockSettingsState.workspaceTargets,
      browserProviders: mockSettingsState.browserProviders,
      expoAccounts: mockSettingsState.expoAccounts,
      expoProjects: mockSettingsState.expoProjects,
      theme: 'dark',
      systemPrompt: 'You are helpful',
      thinkingLevel: 'medium',
      webSearchProvider: 'auto',
      addProvider: mockSettings.addProvider,
      updateProvider: mockSettings.updateProvider,
      removeProvider: mockSettings.removeProvider,
      addMcpServer: mockSettings.addMcpServer,
      updateMcpServer: mockSettings.updateMcpServer,
      removeMcpServer: mockSettings.removeMcpServer,
      addSshTarget: mockSettings.addSshTarget,
      updateSshTarget: mockSettings.updateSshTarget,
      removeSshTarget: mockSettings.removeSshTarget,
      addWorkspaceTarget: mockSettings.addWorkspaceTarget,
      updateWorkspaceTarget: mockSettings.updateWorkspaceTarget,
      removeWorkspaceTarget: mockSettings.removeWorkspaceTarget,
      addBrowserProvider: mockSettings.addBrowserProvider,
      updateBrowserProvider: mockSettings.updateBrowserProvider,
      removeBrowserProvider: mockSettings.removeBrowserProvider,
      addExpoAccount: mockSettings.addExpoAccount,
      updateExpoAccount: mockSettings.updateExpoAccount,
      removeExpoAccount: mockSettings.removeExpoAccount,
      addExpoProject: mockSettings.addExpoProject,
      updateExpoProject: mockSettings.updateExpoProject,
      removeExpoProject: mockSettings.removeExpoProject,
      setTheme: mockSettings.setTheme,
      setSystemPrompt: mockSettings.setSystemPrompt,
      setThinkingLevel: mockSettings.setThinkingLevel,
      setWebSearchProvider: mockSettings.setWebSearchProvider,
      locale: 'en',
      setLocale: mockSettings.setLocale,
      linkUnderstandingEnabled: true,
      mediaUnderstandingEnabled: true,
      maxLinks: 3,
      defaultConversationMode: 'agentic',
      setLinkUnderstandingEnabled: jest.fn(),
      setMediaUnderstandingEnabled: jest.fn(),
      setMaxLinks: jest.fn(),
      setDefaultConversationMode: jest.fn(),
    };
    return selector(state);
  },
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: (selector: (s: any) => any) =>
    selector({ clearAllConversations: mockSettings.clearAllConversations }),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  saveProviderApiKey: jest.fn().mockResolvedValue(undefined),
  getProviderApiKey: jest.fn().mockResolvedValue('sk-test'),
  deleteProviderApiKey: jest.fn().mockResolvedValue(undefined),
  deleteMcpOAuthClientSecret: jest.fn().mockResolvedValue(undefined),
  getMcpOAuthClientSecret: jest.fn().mockResolvedValue(''),
  saveMcpOAuthClientSecret: jest.fn().mockResolvedValue(undefined),
  saveSecure: (...args: any[]) => mockSettings.saveSecure(...args),
  getSecure: (...args: any[]) => mockSettings.getSecure(...args),
  deleteSecure: (...args: any[]) => mockSettings.deleteSecure(...args),
}));

jest.mock('../../src/services/localLlm/availability', () => {
  const actual = jest.requireActual('../../src/services/localLlm/availability');
  return {
    ...actual,
    getLocalLlmAvailability: (...args: any[]) => mockSettings.getLocalLlmAvailability(...args),
  };
});

jest.mock('../../src/services/localLlm/install', () => {
  const actual = jest.requireActual('../../src/services/localLlm/install');
  return {
    ...actual,
    installLocalLlmModel: (...args: any[]) => mockSettings.installLocalLlmModel(...args),
  };
});

jest.mock('../../src/services/expo/projectState', () => ({
  getExpoProjectDisplayOwner: (project: any, account: any) =>
    project.owner || account?.owner || 'owner',
}));

jest.mock('../../src/services/expo/projectAutomation', () => ({
  getExpoProjectExecutionMode: (project: any) => project.mode || 'eas-workflow',
  getExpoProjectReadiness: () => ({ launchable: true, reason: 'ready' }),
  getExpoProjectReadinessLabel: () => 'Ready',
}));

jest.mock('../../src/services/expo/projectSync', () => ({
  syncExpoAccountProjects: (...args: any[]) => mockSettings.syncExpoAccountProjects(...args),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  clearStoredSshSecrets: jest.fn().mockResolvedValue(undefined),
  getSshHostFingerprint: jest.fn().mockResolvedValue('AA:BB:CC:DD'),
  getSshHostKeyPolicyLabel: (target: any) =>
    target.hostKeyPolicy === 'strict' ? 'Strict fingerprint' : 'Trust on first use',
  getSshTargetAuthModeLabel: (target: any) =>
    target.authMode === 'private-key' ? 'Private key' : 'Password',
  getSshTargetReadiness: (target: any) => ({
    launchable: Boolean(
      target.host &&
      target.username &&
      (target.passwordRef || target.privateKeyRef || target.authMode !== 'password'),
    ),
    reason: 'ready',
  }),
  SSH_HOST_KEY_POLICY_OPTIONS: ['trust-on-first-use', 'strict'],
}));

jest.mock('../../src/services/ssh/native', () => ({
  SSH_AUTH_MODE_OPTIONS: [
    { value: 'password', labelKey: 'settings.sshAuthPassword' },
    { value: 'private-key', labelKey: 'settings.sshAuthPrivateKey' },
  ],
  SSH_PTY_OPTIONS: [
    { value: 'xterm', label: 'xterm' },
    { value: 'vt100', label: 'vt100' },
  ],
  supportsVerifiedSshConnections: () => true,
}));

jest.mock('../../src/services/browser/providers/registry', () => ({
  applyBrowserProviderPreset: (config: any) => config,
  BROWSER_PROVIDER_OPTIONS: ['browserbase', 'browserless', 'custom'],
  BROWSER_PROVIDER_AUTH_OPTIONS: ['none', 'api-key-header', 'bearer', 'query-token'],
  BROWSER_PROVIDER_PRESETS: [
    { id: 'browserbase-default', label: 'Browserbase' },
    { id: 'browserless-sfo', label: 'Browserless SFO' },
  ],
  isValidBrowserProviderBaseUrl: (url?: string) => Boolean(url?.startsWith('http')),
}));

jest.mock('../../src/services/browser/providers/readiness', () => ({
  getBrowserProviderReadiness: (provider: any) => ({
    launchable: Boolean(
      provider.baseUrl && (provider.projectId || provider.provider !== 'browserbase'),
    ),
    reason: 'ready',
  }),
}));

jest.mock('../../src/services/browser/providers/labels', () => ({
  getBrowserProviderAuthHint: () => 'Auth hint',
  getBrowserProviderAuthLabel: (mode: string) => mode,
  getBrowserProviderLabel: (provider: string) =>
    provider === 'browserless'
      ? 'Browserless'
      : provider === 'custom'
        ? 'Custom Browser Worker'
        : 'Browserbase',
}));

jest.mock('../../src/services/mcp/oauth', () => ({
  clearMcpOAuth: jest.fn().mockResolvedValue(undefined),
  hasStoredMcpOAuth: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../src/services/security/permissions', () => ({
  useToolPermissionsStore: (selector: (state: any) => any) => selector(mockPermissionStoreState),
}));

jest.mock('../../src/services/agents/store', () => ({
  usePersonaConfigStore: (selector: (state: any) => any) => selector(mockPersonaStoreState),
}));

jest.mock('../../src/services/agents/registry', () => ({
  getAvailablePersonasForConfig: () => mockAvailablePersonas,
  getAvailablePersonas: () => mockAvailablePersonas,
}));

export const setupSettingsScreenTestSuite = () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.getSecure.mockResolvedValue('');
    mockSettings.saveSecure.mockResolvedValue(undefined);
    mockSettings.deleteSecure.mockResolvedValue(undefined);
    mockSettings.getLocalLlmAvailability.mockReset();
    mockSettings.getLocalLlmAvailability.mockResolvedValue({
      available: true,
      linked: true,
      platform: 'android',
      runtime: 'litert-lm',
      supportsStreaming: true,
      deviceMemoryGb: 8,
      lowMemoryDevice: false,
      reason: null,
      warningReason: null,
    });
    mockSettings.installLocalLlmModel.mockReset();
    mockSettings.installLocalLlmModel.mockImplementation(
      async (provider: any, _modelId?: string, options?: any) => {
        const catalogEntry = getLocalLlmCatalogEntry(provider.model);
        options?.onProgress?.({
          modelId: provider.model,
          bytesWritten: catalogEntry?.sizeBytes || 1,
          totalBytes: catalogEntry?.sizeBytes || 1,
          fraction: 1,
        });
        return buildInstalledLocalProvider(provider);
      },
    );
    mockSettings.syncExpoAccountProjects.mockResolvedValue({
      accountId: 'expo-account-1',
      syncedAt: 1,
      projectCount: 1,
      projects: [],
    });
    Object.assign(mockSettingsState, createSettingsRemoteConfigCollections());
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });
};
