// ---------------------------------------------------------------------------
// Tests — SettingsScreen
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { File } from 'expo-file-system';
import { LOCALE_DISPLAY_NAMES } from '../../src/i18n';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { getLocalLlmCatalogEntry } from '../../src/services/localLlm/catalog';

// Mock navigation
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    navigate: mockNavigate,
    openDrawer: jest.fn(),
    closeDrawer: jest.fn(),
  }),
  useRoute: () => ({ name: 'Settings', params: {} }),
  useFocusEffect: jest.fn(),
}));

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

// Mock theme
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
  actual.i18n.setLocale = (...args: any[]) => mockI18nSetLocale(...args);
  return {
    ...actual,
    i18n: actual.i18n,
  };
});

// Mock stores
const mockProviders = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-5.4',
    enabled: true,
  },
];
let mockMcpServers = [
  {
    id: 'mcp1',
    name: 'Test MCP',
    url: 'https://mcp.test.com',
    enabled: true,
    tools: [],
    allowedTools: [],
  },
];
let mockSshTargets: any[] = [];
let mockWorkspaceTargets: any[] = [];
let mockBrowserProviders: any[] = [];
let mockExpoAccounts: any[] = [];
let mockExpoProjects: any[] = [];

const mockAddProvider = jest.fn();
const mockUpdateProvider = jest.fn();
const mockRemoveProvider = jest.fn();
const mockAddMcpServer = jest.fn();
const mockUpdateMcpServer = jest.fn();
const mockRemoveMcpServer = jest.fn();
const mockAddSshTarget = jest.fn();
const mockUpdateSshTarget = jest.fn();
const mockRemoveSshTarget = jest.fn();
const mockAddWorkspaceTarget = jest.fn();
const mockUpdateWorkspaceTarget = jest.fn();
const mockRemoveWorkspaceTarget = jest.fn();
const mockAddBrowserProvider = jest.fn();
const mockUpdateBrowserProvider = jest.fn();
const mockRemoveBrowserProvider = jest.fn();
const mockAddExpoAccount = jest.fn();
const mockUpdateExpoAccount = jest.fn();
const mockRemoveExpoAccount = jest.fn();
const mockAddExpoProject = jest.fn();
const mockUpdateExpoProject = jest.fn();
const mockRemoveExpoProject = jest.fn();
const mockSetTheme = jest.fn();
const mockSetSystemPrompt = jest.fn();
const mockSetThinkingLevel = jest.fn();
const mockSetLocale = jest.fn();
const mockI18nSetLocale = jest.fn().mockResolvedValue(undefined);
const mockSetWebSearchProvider = jest.fn();
const mockClearAllConversations = jest.fn();
const mockGetSecure = jest.fn().mockResolvedValue('');
const mockSaveSecure = jest.fn().mockResolvedValue(undefined);
const mockDeleteSecure = jest.fn().mockResolvedValue(undefined);
const mockInstallLocalLlmModel = jest.fn();
const mockGetLocalLlmAvailability = jest.fn();
const mockSyncExpoAccountProjects = jest.fn().mockResolvedValue({ accountId: 'expo-account-1', syncedAt: Date.now(), projectCount: 1, projects: [] });
const mockSetPermission = jest.fn();
const mockSetPersonaOverride = jest.fn();
const mockUpsertCustomPersona = jest.fn();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
  const firstArg = args[0];
  if (typeof firstArg === 'string' && firstArg.includes('not wrapped in act')) {
    return;
  }
});

const mockPersonaStoreState = {
  overrides: {},
  customPersonas: [],
  setOverride: mockSetPersonaOverride,
  upsertCustomPersona: mockUpsertCustomPersona,
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
  setPermission: mockSetPermission,
};

const buildInstalledLocalProvider = (provider: any) => {
  const catalogEntry = getLocalLlmCatalogEntry(provider.model);
  const localPath = `file:///mock/documents/local-llm/models/${catalogEntry?.fileName || provider.model}`;
  new File(localPath).write('downloaded');
  (jest.requireMock('expo-file-system') as any).__setFileSize?.(localPath, catalogEntry?.sizeBytes || 1);
  return {
    ...provider,
    local: {
      ...provider.local,
      installedModels: [{
        modelId: provider.model,
        fileName: catalogEntry?.fileName || provider.model,
        localPath,
        installedAt: 1,
        sizeBytes: catalogEntry?.sizeBytes || 1,
        sourceUrl: catalogEntry?.downloadUrl || 'https://example.com/model',
      }],
    },
  };
};

const confirmDestructiveAlert = () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: any) => {
    const destructive = buttons?.find((button: any) => button.style === 'destructive');
    destructive?.onPress?.();
  });
};

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: any) => any) => {
    const state = {
      providers: mockProviders,
      mcpServers: mockMcpServers,
      sshTargets: mockSshTargets,
      workspaceTargets: mockWorkspaceTargets,
      browserProviders: mockBrowserProviders,
      expoAccounts: mockExpoAccounts,
      expoProjects: mockExpoProjects,
      theme: 'dark',
      systemPrompt: 'You are helpful',
      thinkingLevel: 'medium',
      webSearchProvider: 'auto',
      addProvider: mockAddProvider,
      updateProvider: mockUpdateProvider,
      removeProvider: mockRemoveProvider,
      addMcpServer: mockAddMcpServer,
      updateMcpServer: mockUpdateMcpServer,
      removeMcpServer: mockRemoveMcpServer,
      addSshTarget: mockAddSshTarget,
      updateSshTarget: mockUpdateSshTarget,
      removeSshTarget: mockRemoveSshTarget,
      addWorkspaceTarget: mockAddWorkspaceTarget,
      updateWorkspaceTarget: mockUpdateWorkspaceTarget,
      removeWorkspaceTarget: mockRemoveWorkspaceTarget,
      addBrowserProvider: mockAddBrowserProvider,
      updateBrowserProvider: mockUpdateBrowserProvider,
      removeBrowserProvider: mockRemoveBrowserProvider,
      addExpoAccount: mockAddExpoAccount,
      updateExpoAccount: mockUpdateExpoAccount,
      removeExpoAccount: mockRemoveExpoAccount,
      addExpoProject: mockAddExpoProject,
      updateExpoProject: mockUpdateExpoProject,
      removeExpoProject: mockRemoveExpoProject,
      setTheme: mockSetTheme,
      setSystemPrompt: mockSetSystemPrompt,
      setThinkingLevel: mockSetThinkingLevel,
      setWebSearchProvider: mockSetWebSearchProvider,
      locale: 'en',
      setLocale: mockSetLocale,
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
  useChatStore: (selector: (s: any) => any) => {
    const state = {
      clearAllConversations: mockClearAllConversations,
    };
    return selector(state);
  },
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  saveProviderApiKey: jest.fn().mockResolvedValue(undefined),
  getProviderApiKey: jest.fn().mockResolvedValue('sk-test'),
  deleteProviderApiKey: jest.fn().mockResolvedValue(undefined),
  deleteMcpOAuthClientSecret: jest.fn().mockResolvedValue(undefined),
  getMcpOAuthClientSecret: jest.fn().mockResolvedValue(''),
  saveMcpOAuthClientSecret: jest.fn().mockResolvedValue(undefined),
  saveSecure: (...args: any[]) => mockSaveSecure(...args),
  getSecure: (...args: any[]) => mockGetSecure(...args),
  deleteSecure: (...args: any[]) => mockDeleteSecure(...args),
}));

jest.mock('../../src/services/localLlm/runtime', () => {
  const actual = jest.requireActual('../../src/services/localLlm/runtime');
  return {
    ...actual,
    getLocalLlmAvailability: (...args: any[]) => mockGetLocalLlmAvailability(...args),
    installLocalLlmModel: (...args: any[]) => mockInstallLocalLlmModel(...args),
  };
});

jest.mock('../../src/services/expo/eas', () => ({
  getExpoProjectExecutionMode: (project: any) => project.mode || 'eas-workflow',
  getExpoProjectDisplayOwner: (project: any, account: any) => project.owner || account?.owner || 'owner',
  getExpoProjectReadiness: () => ({ launchable: true, reason: 'ready' }),
  getExpoProjectReadinessLabel: () => 'Ready',
  syncExpoAccountProjects: (...args: any[]) => mockSyncExpoAccountProjects(...args),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  clearStoredSshSecrets: jest.fn().mockResolvedValue(undefined),
  getSshHostFingerprint: jest.fn().mockResolvedValue('AA:BB:CC:DD'),
  getSshHostKeyPolicyLabel: (target: any) => target.hostKeyPolicy === 'strict' ? 'Strict fingerprint' : 'Trust on first use',
  getSshTargetAuthModeLabel: (target: any) => target.authMode === 'private-key' ? 'Private key' : 'Password',
  getSshTargetReadiness: (target: any) => ({ launchable: Boolean(target.host && target.username && (target.passwordRef || target.privateKeyRef || target.authMode !== 'password')), reason: 'ready' }),
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

jest.mock('../../src/services/browser/providers', () => ({
  applyBrowserProviderPreset: (config: any) => config,
  BROWSER_PROVIDER_OPTIONS: ['browserbase', 'browserless', 'custom'],
  BROWSER_PROVIDER_AUTH_OPTIONS: ['none', 'api-key-header', 'bearer', 'query-token'],
  BROWSER_PROVIDER_PRESETS: [
    { id: 'browserbase-default', label: 'Browserbase' },
    { id: 'browserless-sfo', label: 'Browserless SFO' },
  ],
  getBrowserProviderAuthHint: () => 'Auth hint',
  getBrowserProviderAuthLabel: (mode: string) => mode,
  getBrowserProviderLabel: (provider: string) => provider === 'browserless' ? 'Browserless' : provider === 'custom' ? 'Custom Browser Worker' : 'Browserbase',
  getBrowserProviderReadiness: (provider: any) => ({ launchable: Boolean(provider.baseUrl && (provider.projectId || provider.provider !== 'browserbase')), reason: 'ready' }),
  isValidBrowserProviderBaseUrl: (url?: string) => Boolean(url?.startsWith('http')),
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

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSecure.mockResolvedValue('');
    mockSaveSecure.mockResolvedValue(undefined);
    mockDeleteSecure.mockResolvedValue(undefined);
    mockGetLocalLlmAvailability.mockReset();
    mockGetLocalLlmAvailability.mockResolvedValue({
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
    mockInstallLocalLlmModel.mockReset();
    mockInstallLocalLlmModel.mockImplementation(async (provider: any, _modelId?: string, options?: any) => {
      const catalogEntry = getLocalLlmCatalogEntry(provider.model);
      options?.onProgress?.({
        modelId: provider.model,
        bytesWritten: catalogEntry?.sizeBytes || 1,
        totalBytes: catalogEntry?.sizeBytes || 1,
        fraction: 1,
      });
      return buildInstalledLocalProvider(provider);
    });
    mockSyncExpoAccountProjects.mockResolvedValue({ accountId: 'expo-account-1', syncedAt: 1, projectCount: 1, projects: [] });
    mockMcpServers = [
      {
        id: 'mcp1',
        name: 'Test MCP',
        url: 'https://mcp.test.com',
        enabled: true,
        tools: [],
        allowedTools: [],
      },
    ];
    mockSshTargets = [];
    mockWorkspaceTargets = [];
    mockBrowserProviders = [];
    mockExpoAccounts = [];
    mockExpoProjects = [];
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  it('should render the settings screen with title', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Settings')).toBeTruthy();
  });

  it('should render theme section', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Appearance')).toBeTruthy();
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Dark')).toBeTruthy();
    expect(getByText('System')).toBeTruthy();
  });

  it('should render quick setup and section navigation chips', () => {
    const { getByText, getAllByText } = render(<SettingsScreen />);
    expect(getByText('Quick Setup')).toBeTruthy();
    expect(getByText('Overview')).toBeTruthy();
    expect(getAllByText('Assistant').length).toBeGreaterThan(0);
    expect(getAllByText('Tools').length).toBeGreaterThan(0);
    expect(getAllByText('Surfaces').length).toBeGreaterThan(0);
  });

  it('should change theme on button press', () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Light'));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('should change theme to system', () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('System'));
    expect(mockSetTheme).toHaveBeenCalledWith('system');
  });

  it('should render system prompt section', () => {
    const { getAllByText, getByDisplayValue } = render(<SettingsScreen />);
    expect(getAllByText('System Prompt').length).toBeGreaterThan(0);
    expect(getByDisplayValue('You are helpful')).toBeTruthy();
  });

  it('should update system prompt', () => {
    const { getByDisplayValue } = render(<SettingsScreen />);
    const input = getByDisplayValue('You are helpful');
    fireEvent.changeText(input, 'New prompt');
    expect(mockSetSystemPrompt).toHaveBeenCalledWith('New prompt');
  });

  it('should render providers section', () => {
    const { getByText, getAllByText } = render(<SettingsScreen />);
    expect(getByText('AI Providers')).toBeTruthy();
    // "OpenAI" appears in both the provider list and the preset chips
    expect(getAllByText('OpenAI').length).toBeGreaterThanOrEqual(1);
  });

  it('should render MCP servers section', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('MCP Servers')).toBeTruthy();
    expect(getByText('Test MCP')).toBeTruthy();
    expect(getByText('Manual server · Auto transport · No auth')).toBeTruthy();
  });

  it('should render execution surface sections', () => {
    const { getByText, getAllByText } = render(<SettingsScreen />);
    expect(getByText('Execution Surfaces')).toBeTruthy();
    expect(getAllByText('SSH Targets').length).toBeGreaterThan(0);
    expect(getAllByText('Workspace Targets').length).toBeGreaterThan(0);
    expect(getAllByText('Browser Providers').length).toBeGreaterThan(0);
    expect(getAllByText('Expo Accounts').length).toBeGreaterThan(0);
    expect(getAllByText('Expo Projects').length).toBeGreaterThan(0);
  });

  it('should show clear all conversations button', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Clear All Conversations')).toBeTruthy();
  });

  it('should show confirmation dialog when clearing conversations', () => {
    jest.spyOn(Alert, 'alert');
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Clear All Conversations'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Clear All Conversations',
      expect.any(String),
      expect.any(Array),
    );
  });

  it('should navigate back on arrow press', () => {
    const { getByTestId } = render(<SettingsScreen />);
    const arrowIcon = getByTestId('icon-ArrowLeft');
    fireEvent.press(arrowIcon.parent || arrowIcon);
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('should render known provider presets', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Anthropic')).toBeTruthy();
  });

  it('should render data section title', () => {
    const { getAllByText } = render(<SettingsScreen />);
    expect(getAllByText('Data').length).toBeGreaterThan(0);
  });

  it('should render web search provider controls', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Web Search Provider')).toBeTruthy();
    expect(getByText('Brave')).toBeTruthy();
  });

  it('should render the new setup and configuration sections', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Thinking Level')).toBeTruthy();
    expect(getByText('Tool Permissions')).toBeTruthy();
    expect(getByText('Configure Personas')).toBeTruthy();
    expect(getByText('OpenWeather API Key')).toBeTruthy();
  });

  it('should update the preferred web search provider', () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Brave'));
    expect(mockSetWebSearchProvider).toHaveBeenCalledWith('brave');
  });

  it('should update the thinking level', () => {
    const { getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Use High thinking level'));
    expect(mockSetThinkingLevel).toHaveBeenCalledWith('high');
  });

  it('should support selecting every thinking level option', () => {
    const { getByLabelText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Use Off thinking level'));
    fireEvent.press(getByLabelText('Use Minimal thinking level'));
    fireEvent.press(getByLabelText('Use Low thinking level'));
    fireEvent.press(getByLabelText('Use Medium thinking level'));
    fireEvent.press(getByLabelText('Use High thinking level'));
    fireEvent.press(getByLabelText('Use Max thinking level'));

    expect(mockSetThinkingLevel).toHaveBeenNthCalledWith(1, 'off');
    expect(mockSetThinkingLevel).toHaveBeenNthCalledWith(2, 'minimal');
    expect(mockSetThinkingLevel).toHaveBeenNthCalledWith(3, 'low');
    expect(mockSetThinkingLevel).toHaveBeenNthCalledWith(4, 'medium');
    expect(mockSetThinkingLevel).toHaveBeenNthCalledWith(5, 'high');
    expect(mockSetThinkingLevel).toHaveBeenNthCalledWith(6, 'xhigh');
  });

  it('should update the locale from the language picker', async () => {
    const { getByLabelText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Language'));
    fireEvent.press(getByLabelText(LOCALE_DISPLAY_NAMES.de));

    await waitFor(() => {
      expect(mockSetLocale).toHaveBeenCalledWith('de');
      expect(mockI18nSetLocale).toHaveBeenCalledWith('de');
    });
  });

  it('should save persona configuration for a built-in persona', () => {
    const { getByDisplayValue, getByText } = render(<SettingsScreen />);
    fireEvent.changeText(getByDisplayValue('Assistant'), 'Assistant Pro');
    fireEvent.press(getByText('Save Persona Configuration'));
    expect(mockSetPersonaOverride).toHaveBeenCalledWith('default', expect.objectContaining({ name: 'Assistant Pro' }));
  });

  it('should toggle a tool permission', () => {
    const { getAllByRole } = render(<SettingsScreen />);
    const switches = getAllByRole('switch');
    fireEvent(switches[2], 'valueChange', false);
    expect(mockSetPermission).toHaveBeenCalled();
  });

  it('should navigate to provider edit when provider is tapped', async () => {
    const { getByText } = render(<SettingsScreen />);
    // Tap the OpenAI provider in the list (not the preset chip)
    // The provider list item shows "gpt-5.4" as subtitle
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Edit Provider')).toBeTruthy();
    });
  });

  it('should navigate to new provider edit when Plus button is tapped', () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add provider'));
    expect(getByText('Add Provider')).toBeTruthy();
  });

  it('should navigate to provider edit via preset chip', () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Anthropic'));
    expect(getByText('Add Provider')).toBeTruthy();
  });

  it('should show provider edit form fields', async () => {
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Name')).toBeTruthy();
      expect(getByText('Base URL')).toBeTruthy();
      expect(getByText('API Key')).toBeTruthy();
      expect(getByText('Default Model')).toBeTruthy();
      expect(getByText('Enabled')).toBeTruthy();
      expect(getByText('Save')).toBeTruthy();
    });
  });

  it('should toggle API key visibility', async () => {
    const { getByText, getByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('API Key')).toBeTruthy();
    });
    const eyeIcon = getByTestId('icon-Eye');
    fireEvent.press(eyeIcon.parent || eyeIcon);
    expect(getByTestId('icon-EyeOff')).toBeTruthy();
  });

  it('should show delete provider button for existing providers', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Delete Provider')).toBeTruthy();
    });
  });

  it('should save provider and return to main', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(getByText('Settings')).toBeTruthy();
    });
  });

  it('should go back from provider edit to main', async () => {
    const { getByText, getAllByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Edit Provider')).toBeTruthy();
    });
    const arrowIcons = getAllByTestId('icon-ArrowLeft');
    fireEvent.press(arrowIcons[0].parent || arrowIcons[0]);
    expect(getByText('Settings')).toBeTruthy();
  });

  it('should navigate to MCP edit when server is tapped', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Edit MCP Server')).toBeTruthy();
    });
  });

  it('should navigate to new MCP edit when Plus button is tapped', () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add MCP server'));
    expect(getByText('Add MCP Server')).toBeTruthy();
  });

  it('should navigate to new SSH target edit when SSH plus button is tapped', () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add SSH target'));
    expect(getByText('Add SSH Target')).toBeTruthy();
  });

  it('should save a new SSH target', () => {
    const { getByText, getByLabelText, getByPlaceholderText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add SSH target'));
    fireEvent.changeText(getByPlaceholderText('ssh.example.com'), 'ssh.example.com');
    fireEvent.changeText(getByPlaceholderText('developer'), 'mohamed');
    fireEvent.changeText(getByPlaceholderText('SSH password'), 'top-secret');
    fireEvent.press(getByText('Save'));
    return waitFor(() => {
      expect(mockSaveSecure).toHaveBeenCalledWith(expect.stringContaining('ssh_password_'), 'top-secret');
      expect(mockAddSshTarget).toHaveBeenCalledWith(expect.objectContaining({
        host: 'ssh.example.com',
        authMode: 'password',
        passwordRef: expect.stringContaining('ssh_password_'),
      }));
    });
  });

  it('should save an SSH target with private key auth', async () => {
    const { getByText, getByLabelText, getByPlaceholderText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add SSH target'));
    fireEvent.changeText(getByPlaceholderText('ssh.example.com'), 'ssh.example.com');
    fireEvent.changeText(getByPlaceholderText('developer'), 'mohamed');
    fireEvent.press(getByText('Private key'));
    fireEvent.changeText(getByPlaceholderText('-----BEGIN OPENSSH PRIVATE KEY-----'), 'PRIVATE KEY');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockSaveSecure).toHaveBeenCalledWith(expect.stringContaining('ssh_private_key_'), 'PRIVATE KEY');
      expect(mockAddSshTarget).toHaveBeenCalledWith(expect.objectContaining({
        authMode: 'private-key',
        privateKeyRef: expect.stringContaining('ssh_private_key_'),
      }));
    });
  });

  it('should navigate to new workspace target edit when workspace plus button is tapped', () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add Workspace Target'));
    expect(getByText('Add Workspace Target')).toBeTruthy();
  });

  it('should save a new workspace target', () => {
    const { getByText, getByLabelText, getByPlaceholderText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add Workspace Target'));
    fireEvent.changeText(getByPlaceholderText('/Users/username/project'), '/tmp/project');
    fireEvent.press(getByText('Save'));
    return waitFor(() => {
      expect(mockAddWorkspaceTarget).toHaveBeenCalledWith(expect.objectContaining({
        rootPath: '/tmp/project',
        provider: 'code-server',
        authMode: 'none',
      }));
    });
  });

  it('should save a workspace access token securely when token auth is configured', async () => {
    const { getByText, getByLabelText, getByPlaceholderText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add Workspace Target'));
    fireEvent.changeText(getByPlaceholderText('/Users/username/project'), '/tmp/project');
    fireEvent.changeText(getByPlaceholderText('https://code.example.com'), 'https://code.example.com');
    fireEvent.press(getByText('Bearer token'));
    fireEvent.changeText(getByPlaceholderText('workspace token'), 'secret-token');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockSaveSecure).toHaveBeenCalledWith(expect.stringContaining('workspace_access_token_'), 'secret-token');
      expect(mockAddWorkspaceTarget).toHaveBeenCalledWith(expect.objectContaining({
        baseUrl: 'https://code.example.com',
        authMode: 'bearer',
        accessTokenRef: expect.stringContaining('workspace_access_token_'),
      }));
    });
  });

  it('should show MCP edit form fields', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Name')).toBeTruthy();
      expect(getByText('URL')).toBeTruthy();
      expect(getByText('Token (optional)')).toBeTruthy();
      expect(getByText('Enabled')).toBeTruthy();
      expect(getByText('Save')).toBeTruthy();
      expect(getByText('Connection metadata')).toBeTruthy();
      expect(getByText('Manual server')).toBeTruthy();
      expect(getByText('Auto transport')).toBeTruthy();
      expect(getByText('No auth')).toBeTruthy();
    });
  });

  it('should persist normalized trust and capability metadata when saving an MCP server', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));

    expect(mockUpdateMcpServer).toHaveBeenCalledWith(expect.objectContaining({
      trust: { source: 'manual' },
      capabilities: expect.objectContaining({
        transport: 'auto',
        authMode: 'none',
        requiresConfiguration: false,
        requiresSecrets: false,
      }),
    }));
  });

  it('should let the user reset a stored OAuth session from MCP settings', async () => {
    const { hasStoredMcpOAuth, clearMcpOAuth } = require('../../src/services/mcp/oauth');
    hasStoredMcpOAuth.mockResolvedValue(true);
    mockMcpServers = [
      {
        id: 'mcp1',
        name: 'Test MCP',
        url: 'https://mcp.test.com',
        enabled: true,
        tools: [],
        allowedTools: [],
        oauth: { clientId: 'mobile-client' },
      } as any,
    ];
    jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      const destructive = buttons?.find((button: any) => button.style === 'destructive');
      destructive?.onPress?.();
    });

    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));

    await waitFor(() => {
      expect(getByText('OAuth session saved')).toBeTruthy();
      expect(getByText('Reset OAuth session')).toBeTruthy();
    });

    fireEvent.press(getByText('Reset OAuth session'));

    await waitFor(() => {
      expect(clearMcpOAuth).toHaveBeenCalledWith('mcp1');
    });
  });

  it('should show delete MCP server button for existing servers', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Delete MCP Server')).toBeTruthy();
    });
  });

  it('should save MCP server and return to main', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(getByText('Settings')).toBeTruthy();
    });
  });

  it('should go back from MCP edit to main', async () => {
    const { getByText, getAllByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Edit MCP Server')).toBeTruthy();
    });
    const arrowIcons = getAllByTestId('icon-ArrowLeft');
    fireEvent.press(arrowIcons[0].parent || arrowIcons[0]);
    expect(getByText('Settings')).toBeTruthy();
  });

  it('should show delete confirmation for MCP server', async () => {
    jest.spyOn(Alert, 'alert');
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Delete MCP Server')).toBeTruthy();
    });
    fireEvent.press(getByText('Delete MCP Server'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete MCP Server',
      expect.any(String),
      expect.any(Array),
    );
  });

  it('should show delete confirmation for provider', async () => {
    jest.spyOn(Alert, 'alert');
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Delete Provider')).toBeTruthy();
    });
    fireEvent.press(getByText('Delete Provider'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Provider',
      expect.any(String),
      expect.any(Array),
    );
  });

  it('should render theme icons', () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId('icon-Sun')).toBeTruthy();
    expect(getByTestId('icon-Moon')).toBeTruthy();
    expect(getByTestId('icon-Monitor')).toBeTruthy();
  });

  it('should edit provider name field', async () => {
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('OpenAI')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('OpenAI'), 'My Provider');
    expect(getByDisplayValue('My Provider')).toBeTruthy();
  });

  it('should edit provider base URL field', async () => {
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://api.openai.com/v1'), 'https://custom.api.com');
    expect(getByDisplayValue('https://custom.api.com')).toBeTruthy();
  });

  it('should edit provider model field', async () => {
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('gpt-5.4')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('gpt-5.4'), 'gpt-5-mini');
    expect(getByDisplayValue('gpt-5-mini')).toBeTruthy();
  });

  it('should edit provider API key field', async () => {
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('sk-test')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('sk-test'), 'sk-new-key');
    expect(getByDisplayValue('sk-new-key')).toBeTruthy();
  });

  it('should toggle provider enabled switch', async () => {
    const { getByText, getByRole } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Enabled')).toBeTruthy();
    });
  });

  it('should save new provider with addProvider', async () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add provider'));
    expect(getByText('Add Provider')).toBeTruthy();
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(mockAddProvider).toHaveBeenCalled();
    });
  });

  it('should prefill and save the Gemini preset with the Vertex base URL', async () => {
    const { getByLabelText, getByDisplayValue, getByText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Add Gemini provider'));

    await waitFor(() => {
      expect(getByDisplayValue('Gemini')).toBeTruthy();
      expect(getByDisplayValue('https://aiplatform.googleapis.com/v1')).toBeTruthy();
      expect(getByDisplayValue('gemini-3.1-pro-preview')).toBeTruthy();
    });

    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockAddProvider).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Gemini',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        model: 'gemini-3.1-pro-preview',
      }));
    });
  });

  it('should require an explicit download before saving the on-device Gemma preset', async () => {
    const { saveProviderApiKey } = require('../../src/services/storage/SecureStorage');
    const { getByLabelText, getByText, queryByPlaceholderText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Add Gemma (on-device) provider'));

    await waitFor(() => {
      expect(getByText('On-device Gemma')).toBeTruthy();
    });

    expect(queryByPlaceholderText('https://api.openai.com/v1')).toBeNull();
    expect(queryByPlaceholderText('sk-…')).toBeNull();
    expect(getByText('Download the selected model')).toBeTruthy();

    fireEvent.press(getByText('Save'));

    expect(mockInstallLocalLlmModel).not.toHaveBeenCalled();
    expect(mockAddProvider).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText(/^Download model /));

    await waitFor(() => {
      expect(getByText('Download complete. You can save this provider now.')).toBeTruthy();
    });

    await waitFor(() => {
      expect(getByText('Installed')).toBeTruthy();
    });

    fireEvent.press(getByText('Save').parent as any);

    await waitFor(() => {
      expect(mockInstallLocalLlmModel).toHaveBeenCalledTimes(1);
      expect(mockAddProvider).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'on-device',
        name: 'Gemma (on-device)',
      }));
    });

    expect(saveProviderApiKey).not.toHaveBeenCalled();
  });

  it('should show download progress while fetching an on-device model', async () => {
    let resolveDownload: ((value: any) => void) | null = null;
    let pendingProvider: any = null;
    mockInstallLocalLlmModel.mockImplementationOnce((provider: any, _modelId?: string, options?: any) => (
      new Promise((resolve) => {
        pendingProvider = provider;
        resolveDownload = resolve;
        options?.onProgress?.({
          modelId: provider.model,
          bytesWritten: 50,
          totalBytes: 100,
          fraction: 0.5,
        });
      })
    ));

    const { getByLabelText, getByText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Add Gemma (on-device) provider'));

    await waitFor(() => {
      expect(getByText('Download the selected model')).toBeTruthy();
    });

    fireEvent.press(getByLabelText(/^Download model /));

    await waitFor(() => {
      expect(getByText('Downloading…')).toBeTruthy();
      expect(getByText('50% complete')).toBeTruthy();
    });

    (resolveDownload as ((value: any) => void) | null)?.(
      buildInstalledLocalProvider(pendingProvider),
    );

    await waitFor(() => {
      expect(getByText('Download complete. You can save this provider now.')).toBeTruthy();
    });

    await waitFor(() => {
      expect(getByText('Installed')).toBeTruthy();
    });
  });

  it('should save existing provider with updateProvider', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(mockUpdateProvider).toHaveBeenCalled();
    });
  });

  it('should execute delete provider confirmation', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      // Press the destructive "Delete" button
      const deleteBtn = buttons?.find((b: any) => b.style === 'destructive');
      deleteBtn?.onPress?.();
    });
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByText('Delete Provider')).toBeTruthy();
    });
    fireEvent.press(getByText('Delete Provider'));
    await waitFor(() => {
      expect(mockRemoveProvider).toHaveBeenCalledWith('openai');
    });
  });

  it('should execute delete MCP server confirmation', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      const deleteBtn = buttons?.find((b: any) => b.style === 'destructive');
      deleteBtn?.onPress?.();
    });
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Delete MCP Server')).toBeTruthy();
    });
    fireEvent.press(getByText('Delete MCP Server'));
    expect(mockRemoveMcpServer).toHaveBeenCalledWith('mcp1');
  });

  it('should execute clear all conversations confirmation', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      const deleteBtn = buttons?.find((b: any) => b.style === 'destructive');
      deleteBtn?.onPress?.();
    });
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Clear All Conversations'));
    expect(mockClearAllConversations).toHaveBeenCalled();
  });

  it('should save existing MCP server with updateMcpServer', async () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));
    expect(mockUpdateMcpServer).toHaveBeenCalled();
  });

  it('should save new MCP server with addMcpServer', () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Add MCP server'));
    expect(getByText('Add MCP Server')).toBeTruthy();
    fireEvent.press(getByText('Save'));
    expect(mockAddMcpServer).toHaveBeenCalled();
  });

  it('should edit MCP name field', async () => {
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByDisplayValue('Test MCP')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('Test MCP'), 'Renamed MCP');
    expect(getByDisplayValue('Renamed MCP')).toBeTruthy();
  });

  it('should edit MCP URL field', async () => {
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByDisplayValue('https://mcp.test.com')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://mcp.test.com'), 'https://new-mcp.test.com');
    expect(getByDisplayValue('https://new-mcp.test.com')).toBeTruthy();
  });

  it('should edit MCP token field', async () => {
    const { getByText, getByPlaceholderText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByPlaceholderText('Bearer token')).toBeTruthy();
    });
    const tokenInput = getByPlaceholderText('Bearer token');
    fireEvent.changeText(tokenInput, 'my-secret-token');
  });

  it('should save provider with API key', async () => {
    const { saveProviderApiKey } = require('../../src/services/storage/SecureStorage');
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('sk-test')).toBeTruthy();
    });
    // Change API key and save
    fireEvent.changeText(getByDisplayValue('sk-test'), 'sk-new-key');
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(saveProviderApiKey).toHaveBeenCalledWith('openai', 'sk-new-key');
    });
  });

  it('should reject invalid provider URL on save', async () => {
    jest.spyOn(Alert, 'alert');
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://api.openai.com/v1'), 'not-a-valid-url');
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Invalid URL', expect.any(String));
    });
    expect(mockUpdateProvider).not.toHaveBeenCalled();
  });

  it('should reject ftp:// provider URL on save', async () => {
    jest.spyOn(Alert, 'alert');
    const { getByText, getByDisplayValue } = render(<SettingsScreen />);
    fireEvent.press(getByText('gpt-5.4'));
    await waitFor(() => {
      expect(getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://api.openai.com/v1'), 'ftp://evil.com');
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Invalid URL', 'Provider URL must use http or https.');
    });
    expect(mockUpdateProvider).not.toHaveBeenCalled();
  });

  it('should save a new browser provider with a stored API key', async () => {
    const { getByLabelText, getByPlaceholderText, getByText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.changeText(getByPlaceholderText('bb_project_123'), 'bb_project_42');
    fireEvent.changeText(getByPlaceholderText('browser provider key'), 'browser-secret');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockSaveSecure).toHaveBeenCalledWith(expect.stringContaining('browser_provider_api_key_'), 'browser-secret');
      expect(mockAddBrowserProvider).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'browserbase',
        baseUrl: 'https://api.browserbase.com',
        projectId: 'bb_project_42',
        authMode: 'api-key-header',
        apiKeyRef: expect.stringContaining('browser_provider_api_key_'),
      }));
    });
  });

  it('should reject an invalid browser provider URL', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByDisplayValue, getByText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.changeText(getByDisplayValue('https://api.browserbase.com'), 'ftp://browser.invalid');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Browser provider URL must use http or https.');
    });
    expect(mockAddBrowserProvider).not.toHaveBeenCalled();
  });

  it('should require a query token parameter for browserless providers', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByDisplayValue, getByPlaceholderText, getByText } = render(<SettingsScreen />);

    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.press(getByText('Browserless'));
    fireEvent.changeText(getByDisplayValue('token'), '');
    fireEvent.changeText(getByPlaceholderText('browser provider key'), 'browserless-secret');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'A query token parameter is required for query-token browser authentication.');
    });
    expect(mockAddBrowserProvider).not.toHaveBeenCalled();
  });

  it('should update an existing browser provider and clear a stored secret when auth is disabled', async () => {
    mockBrowserProviders = [
      {
        id: 'browser-1',
        name: 'Browser Ops',
        provider: 'browserbase',
        baseUrl: 'https://api.browserbase.com',
        authMode: 'api-key-header',
        apiKeyRef: 'browser_provider_api_key_browser-1',
        projectId: 'bb_project_live',
        enabled: true,
      },
    ];
    mockGetSecure.mockImplementation(async (key: string) => key === 'browser_provider_api_key_browser-1' ? 'saved-browser-key' : '');

    const { getByDisplayValue, getByText } = render(<SettingsScreen />);

    fireEvent.press(getByText('Browser Ops'));

    await waitFor(() => {
      expect(getByDisplayValue('saved-browser-key')).toBeTruthy();
    });

    fireEvent.press(getByText('none'));
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockDeleteSecure).toHaveBeenCalledWith('browser_provider_api_key_browser-1');
      expect(mockUpdateBrowserProvider).toHaveBeenCalledWith(expect.objectContaining({
        id: 'browser-1',
        authMode: 'none',
        apiKeyRef: undefined,
        queryTokenParam: undefined,
      }));
    });
  });

  it('should execute delete browser provider confirmation', async () => {
    mockBrowserProviders = [
      {
        id: 'browser-1',
        name: 'Browser Ops',
        provider: 'browserbase',
        baseUrl: 'https://api.browserbase.com',
        authMode: 'api-key-header',
        projectId: 'bb_project_live',
        enabled: true,
      },
    ];
    confirmDestructiveAlert();

    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Browser Ops'));

    await waitFor(() => {
      expect(getByText('Delete Browser Provider')).toBeTruthy();
    });

    fireEvent.press(getByText('Delete Browser Provider'));

    await waitFor(() => {
      expect(mockRemoveBrowserProvider).toHaveBeenCalledWith('browser-1');
      expect(mockDeleteSecure).toHaveBeenCalledWith('browser_provider_api_key_browser-1');
    });
  });

  it('should save a new Expo account, persist its token, and sync projects', async () => {
    const { getAllByLabelText, getByDisplayValue, getByPlaceholderText, getByText } = render(<SettingsScreen />);

    fireEvent.press(getAllByLabelText('Add Expo account')[0]);
    fireEvent.changeText(getByDisplayValue('New Expo Account'), '');
    fireEvent.changeText(getByPlaceholderText('my-org'), 'kavi');
    fireEvent.changeText(getByPlaceholderText('eas_xxx'), 'eas_live_token');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockSaveSecure).toHaveBeenCalledWith(expect.stringContaining('expo_account_token_'), 'eas_live_token');
      expect(mockAddExpoAccount).toHaveBeenCalledWith(expect.objectContaining({
        owner: 'kavi',
        name: 'kavi',
        accountType: 'personal',
        tokenRef: expect.stringContaining('expo_account_token_'),
      }));
    });

    const savedAccount = mockAddExpoAccount.mock.calls[0][0];
    expect(mockSyncExpoAccountProjects).toHaveBeenCalledWith(savedAccount.id);
  });

  it('should require an owner before saving a new Expo account', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getAllByLabelText, getByText } = render(<SettingsScreen />);

    fireEvent.press(getAllByLabelText('Add Expo account')[0]);
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Expo account owner is required.');
    });
    expect(mockAddExpoAccount).not.toHaveBeenCalled();
  });

  it('should update an existing Expo account and clear its stored token', async () => {
    mockExpoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'robot',
        enabled: true,
        tokenRef: 'expo_account_token_expo-account-1',
      },
    ];
    mockGetSecure.mockImplementation(async (key: string) => key === 'expo_account_token_expo-account-1' ? 'eas_saved_token' : '');

    const { getByDisplayValue, getByText } = render(<SettingsScreen />);

    fireEvent.press(getByText('Expo Production'));

    await waitFor(() => {
      expect(getByDisplayValue('eas_saved_token')).toBeTruthy();
    });

    fireEvent.changeText(getByDisplayValue('eas_saved_token'), '');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockDeleteSecure).toHaveBeenCalledWith('expo_account_token_expo-account-1');
      expect(mockUpdateExpoAccount).toHaveBeenCalledWith(expect.objectContaining({
        id: 'expo-account-1',
        owner: 'kavi',
        accountType: 'robot',
        tokenRef: undefined,
      }));
    });
    expect(mockSyncExpoAccountProjects).not.toHaveBeenCalled();
  });

  it('should sync Expo projects from the main settings surface', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockExpoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];

    const { getByLabelText } = render(<SettingsScreen />);
    fireEvent.press(getByLabelText('Sync Expo projects'));

    await waitFor(() => {
      expect(mockSyncExpoAccountProjects).toHaveBeenCalledWith('expo-account-1');
      expect(Alert.alert).toHaveBeenCalledWith('Expo projects synced', 'Projects synced: 1');
    });
  });

  it('should execute delete Expo account confirmation', async () => {
    mockExpoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    confirmDestructiveAlert();

    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Expo Production'));

    await waitFor(() => {
      expect(getByText('Delete Expo Account')).toBeTruthy();
    });

    fireEvent.press(getByText('Delete Expo Account'));

    await waitFor(() => {
      expect(mockRemoveExpoAccount).toHaveBeenCalledWith('expo-account-1');
      expect(mockDeleteSecure).toHaveBeenCalledWith('expo_account_token_expo-account-1');
    });
  });

  it('should require a project path for direct SSH Expo projects', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockExpoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    mockSshTargets = [
      {
        id: 'ssh-1',
        name: 'Build Host',
        host: 'ssh.example.com',
        port: 22,
        username: 'deploy',
        authMode: 'password',
        passwordRef: 'ssh_password_ssh-1',
        enabled: true,
      },
    ];
    mockExpoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'direct-ssh',
        sshTargetId: 'ssh-1',
        projectPath: '',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        platforms: ['android'],
      },
    ];

    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Edit Expo Project')).toBeTruthy();
    });

    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Project path is required for direct mode.');
    });
    expect(mockUpdateExpoProject).not.toHaveBeenCalled();
  });

  it('should require a repository for GitHub workflow Expo projects', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockExpoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    mockExpoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'github-workflow',
        repoFullName: '',
        workflowFile: '',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        platforms: ['android', 'ios'],
      },
    ];

    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Edit Expo Project')).toBeTruthy();
    });

    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'GitHub repository is required for workflow mode.');
    });
    expect(mockUpdateExpoProject).not.toHaveBeenCalled();
  });

  it('should require a workflow file for GitHub workflow Expo projects', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockExpoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    mockExpoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'github-workflow',
        repoFullName: 'kavi/client-app',
        workflowFile: '',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        platforms: ['android', 'ios'],
      },
    ];

    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Edit Expo Project')).toBeTruthy();
    });

    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Workflow file is required for workflow mode.');
    });
    expect(mockUpdateExpoProject).not.toHaveBeenCalled();
  });

  it('should save an existing Expo project with normalized fields', async () => {
    mockExpoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    mockExpoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'github-workflow',
        repoFullName: 'kavi/client-app',
        workflowFile: '.github/workflows/deploy.yml',
        workflowRef: 'main',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        webUrl: 'https://app.example.com',
        previewUrl: 'https://preview.example.com',
        customDomain: 'app.example.com',
        platforms: ['android', 'ios'],
      },
    ];

    const { getByDisplayValue, getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Edit Expo Project')).toBeTruthy();
    });

    fireEvent.changeText(getByDisplayValue('Client App'), '  Mobile Client  ');
    fireEvent.changeText(getByDisplayValue('kavi'), '  kavi-team  ');
    fireEvent.changeText(getByDisplayValue('client-app'), '  mobile-client  ');
    fireEvent.changeText(getByDisplayValue('https://preview.example.com'), '');
    fireEvent.changeText(getByDisplayValue('app.example.com'), '');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockUpdateExpoProject).toHaveBeenCalledWith(expect.objectContaining({
        id: 'expo-project-1',
        name: 'Mobile Client',
        owner: 'kavi-team',
        slug: 'mobile-client',
        previewUrl: undefined,
        customDomain: undefined,
        repoFullName: 'kavi/client-app',
        workflowFile: '.github/workflows/deploy.yml',
        platforms: ['android', 'ios'],
      }));
    });
  });

  it('should execute delete Expo project confirmation', async () => {
    mockExpoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    mockExpoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'eas-workflow',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        platforms: ['android', 'ios'],
      },
    ];
    confirmDestructiveAlert();

    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Delete Expo Project')).toBeTruthy();
    });

    fireEvent.press(getByText('Delete Expo Project'));

    await waitFor(() => {
      expect(mockRemoveExpoProject).toHaveBeenCalledWith('expo-project-1');
    });
  });
});
