// ---------------------------------------------------------------------------
// Tests — McpStatusScreen
// ---------------------------------------------------------------------------

import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { McpStatusScreen } from '../../src/screens/McpStatusScreen';

async function flushAsyncInteractions() {
  await Promise.resolve();
  await Promise.resolve();
}

async function pressAndFlush(target: any) {
  await act(async () => {
    fireEvent.press(target);
    await flushAsyncInteractions();
  });
}

const mockListOfficialMcpRegistry = jest.fn();
const mockAddMcpServer = jest.fn();
const mockRemoveMcpServer = jest.fn();

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

// Mock navigation
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ name: 'McpStatus' }),
  useFocusEffect: jest.fn(),
}));

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      header: '#111',
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
      warning: '#ff0',
      success: '#0f0',
    },
  }),
  AppPalette: {},
}));

// Mock settings store with configurable servers
let mockMcpServers: any[] = [];
jest.mock('../../src/store/useSettingsStore', () => {
  const useSettingsStore: any = (selector: any) =>
    selector({
      mcpServers: mockMcpServers,
      addMcpServer: mockAddMcpServer,
      removeMcpServer: mockRemoveMcpServer,
    });

  useSettingsStore.getState = () => ({
    mcpServers: mockMcpServers,
    addMcpServer: mockAddMcpServer,
    removeMcpServer: mockRemoveMcpServer,
  });

  return { useSettingsStore };
});

jest.mock('../../src/services/mcp/registryClient', () => ({
  ...jest.requireActual('../../src/services/mcp/registryClient'),
  listOfficialMcpRegistry: (...args: any[]) => mockListOfficialMcpRegistry(...args),
}));

// Mock the MCP chain
const mockGetStatus = jest.fn();
const mockGetAllStatuses = jest.fn();
const mockConnectServer = jest.fn().mockResolvedValue(undefined);
const mockAuthenticateServer = jest.fn().mockResolvedValue(undefined);
const mockClearServerAuth = jest.fn().mockResolvedValue(undefined);
const mockDisconnectServer = jest.fn();
const mockSubscribe = jest.fn(() => jest.fn());
jest.mock('../../src/services/events/bus', () => ({
  emitMcpEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/mcp/client', () => ({}));
jest.mock('../../src/services/mcp/bridge', () => ({
  mcpToolToDefinition: jest.fn(),
  parseMcpToolName: jest.fn(),
  formatMcpResult: jest.fn(),
  executeMcpTool: jest.fn(),
}));
jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    getStatus: (...args: any[]) => mockGetStatus(...args),
    connectServer: (...args: any[]) => mockConnectServer(...args),
    authenticateServer: (...args: any[]) => mockAuthenticateServer(...args),
    clearServerAuth: (...args: any[]) => mockClearServerAuth(...args),
    disconnectServer: (...args: any[]) => mockDisconnectServer(...args),
    subscribe: (...args: any[]) => mockSubscribe(...args),
    getAllStatuses: (...args: any[]) => mockGetAllStatuses(...args),
  },
  McpServerStatus: {},
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockMcpServers = [];
  mockAddMcpServer.mockImplementation((server: any) => {
    mockMcpServers = [...mockMcpServers, server];
  });
  mockRemoveMcpServer.mockImplementation((id: string) => {
    mockMcpServers = mockMcpServers.filter((server) => server.id !== id);
  });
  mockGetStatus.mockReturnValue(undefined);
  mockGetAllStatuses.mockImplementation(() =>
    mockMcpServers.map(
      (server) =>
        mockGetStatus(server.id) || {
          id: server.id,
          name: server.name,
          state: 'disconnected',
          tools: [],
        },
    ),
  );
  mockListOfficialMcpRegistry.mockResolvedValue({ entries: [], nextCursor: null });
  jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
});

describe('McpStatusScreen', () => {
  it('renders header with title', () => {
    const { getByText } = render(<McpStatusScreen />);
    expect(getByText('MCP Servers')).toBeTruthy();
  });

  it('shows empty state when no servers', () => {
    const { getByText } = render(<McpStatusScreen />);
    expect(getByText('No MCP servers')).toBeTruthy();
    expect(getByText(/Configure MCP servers to extend/)).toBeTruthy();
  });

  it('shows installed and browse tabs', () => {
    const { getByText } = render(<McpStatusScreen />);
    expect(getByText('Installed')).toBeTruthy();
    expect(getByText('Browse')).toBeTruthy();
  });

  it('renders connected server with tools', async () => {
    mockMcpServers = [
      {
        id: 'srv1',
        name: 'Test Server',
        url: 'https://mcp.example.com',
        enabled: true,
        transport: 'streamable-http',
        oauth: { clientId: 'mobile-client' },
        trust: {
          source: 'official-registry',
          registryName: 'com.example/test-server',
          websiteUrl: 'https://example.com/test-server',
        },
        capabilities: {
          transport: 'streamable-http',
          authMode: 'oauth',
          requiresConfiguration: true,
          requiresSecrets: false,
          inputCount: 1,
        },
      },
    ];
    mockGetStatus.mockReturnValue({
      id: 'srv1',
      name: 'Test Server',
      state: 'connected',
      tools: [
        { name: 'tool1', description: 'Tool 1' },
        { name: 'tool2', description: 'Tool 2' },
      ],
    });

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => {
      expect(getByText('Test Server')).toBeTruthy();
      expect(getByText('connected')).toBeTruthy();
      expect(getByText('tool1')).toBeTruthy();
      expect(getByText('tool2')).toBeTruthy();
      expect(getByText('Official registry')).toBeTruthy();
      expect(getByText('HTTP transport')).toBeTruthy();
      expect(getByText('OAuth connected')).toBeTruthy();
      expect(getByText('Configuration required')).toBeTruthy();
      expect(getByText('Registry: com.example/test-server')).toBeTruthy();
      expect(getByText('Website: https://example.com/test-server')).toBeTruthy();
    });
  });

  it('renders error server with reconnect button', async () => {
    mockMcpServers = [
      { id: 'srv1', name: 'Error Server', url: 'https://error.com', enabled: true },
    ];
    mockGetStatus.mockReturnValue({
      id: 'srv1',
      name: 'Error Server',
      state: 'error',
      error: 'Connection timed out',
      tools: [],
    });

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => {
      expect(getByText('Error Server')).toBeTruthy();
      expect(getByText('error')).toBeTruthy();
      expect(getByText('Connection timed out')).toBeTruthy();
      expect(getByText('Reconnect')).toBeTruthy();
    });
  });

  it('renders auth-required server with authenticate action', async () => {
    mockMcpServers = [
      { id: 'srv-auth', name: 'OAuth Server', url: 'https://oauth.example.com/mcp', enabled: true },
    ];
    mockGetStatus.mockReturnValue({
      id: 'srv-auth',
      name: 'OAuth Server',
      state: 'error',
      error: 'Authentication required.',
      tools: [],
      authRequired: true,
      authState: 'unauthenticated',
    });

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => {
      expect(getByText('Authenticate')).toBeTruthy();
    });
  });

  it('starts OAuth authentication from installed card', async () => {
    mockMcpServers = [
      { id: 'srv-auth', name: 'OAuth Server', url: 'https://oauth.example.com/mcp', enabled: true },
    ];
    mockGetStatus.mockReturnValue({
      id: 'srv-auth',
      name: 'OAuth Server',
      state: 'error',
      error: 'Authentication required.',
      tools: [],
      authRequired: true,
      authState: 'unauthenticated',
    });

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => expect(getByText('Authenticate')).toBeTruthy());
    await pressAndFlush(getByText('Authenticate'));
    await waitFor(() => expect(mockAuthenticateServer).toHaveBeenCalledWith(mockMcpServers[0]));
  });

  it('opens settings MCP editor from installed card', async () => {
    mockMcpServers = [
      {
        id: 'srv-edit',
        name: 'Editable Server',
        url: 'https://edit.example.com/mcp',
        enabled: true,
      },
    ];
    mockGetStatus.mockReturnValue({
      id: 'srv-edit',
      name: 'Editable Server',
      state: 'error',
      error: 'Authentication required.',
      tools: [],
    });

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => expect(getByText('Edit')).toBeTruthy());
    fireEvent.press(getByText('Edit'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings', {
      section: 'mcp-edit',
      serverId: 'srv-edit',
    });
  });

  it('handles reconnect press', async () => {
    mockMcpServers = [{ id: 'srv1', name: 'Down Server', url: 'https://down.com', enabled: true }];
    mockGetStatus.mockReturnValue({
      id: 'srv1',
      name: 'Down Server',
      state: 'disconnected',
      tools: [],
    });

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => expect(getByText('Reconnect')).toBeTruthy());
    await pressAndFlush(getByText('Reconnect'));
    await waitFor(() => expect(mockConnectServer).toHaveBeenCalledWith(mockMcpServers[0]));
  });

  it('loads registry entries on browse tab', async () => {
    mockListOfficialMcpRegistry.mockResolvedValueOnce({
      entries: [
        {
          id: 'com.example/remote@1.0.0',
          name: 'Remote MCP',
          registryName: 'com.example/remote',
          description: 'Installable remote tools',
          version: '1.0.0',
          websiteUrl: 'https://example.com/remote',
          trust: {
            source: 'official-registry',
            registryName: 'com.example/remote',
            websiteUrl: 'https://example.com/remote',
          },
          capabilities: {
            transports: ['streamable-http'],
            authMode: 'header',
            requiresConfiguration: true,
            requiresSecrets: true,
            inputCount: 1,
          },
          remotes: [
            {
              id: 'remote-1',
              type: 'streamable-http',
              url: 'https://example.com/mcp',
              label: 'HTTP mcp',
              headers: [
                {
                  key: 'Authorization',
                  label: 'Authorization',
                  kind: 'header',
                  required: true,
                  secret: true,
                },
              ],
              variables: [],
            },
          ],
        },
      ],
      nextCursor: null,
    });

    const { getByText } = render(<McpStatusScreen />);
    await pressAndFlush(getByText('Browse'));

    await waitFor(() => {
      expect(getByText('Remote MCP')).toBeTruthy();
      expect(getByText('Official registry')).toBeTruthy();
      expect(getByText('Header auth')).toBeTruthy();
      expect(getByText('Secrets required')).toBeTruthy();
      expect(getByText('Registry: com.example/remote')).toBeTruthy();
      expect(getByText('Website: https://example.com/remote')).toBeTruthy();
    });
    expect(mockListOfficialMcpRegistry).toHaveBeenCalledWith({
      limit: 20,
      cursor: null,
      search: undefined,
    });
  });

  it('installs a simple remote MCP directly from browse', async () => {
    mockListOfficialMcpRegistry.mockResolvedValueOnce({
      entries: [
        {
          id: 'com.example/remote@1.0.0',
          name: 'Remote MCP',
          registryName: 'com.example/remote',
          description: 'Installable remote tools',
          version: '1.0.0',
          remotes: [
            {
              id: 'remote-1',
              type: 'streamable-http',
              url: 'https://example.com/mcp',
              label: 'HTTP mcp',
              headers: [],
              variables: [],
            },
          ],
        },
      ],
      nextCursor: null,
    });

    const { getAllByText, getByText } = render(<McpStatusScreen />);
    await pressAndFlush(getByText('Browse'));

    await waitFor(() => expect(getByText('Remote MCP')).toBeTruthy());
    await pressAndFlush(getAllByText('Install')[0]);

    await waitFor(() => {
      expect(mockAddMcpServer).toHaveBeenCalledTimes(1);
      expect(mockConnectServer).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalled();
    });
  });

  it('keeps the installed MCP visible after install completes without manual refresh', async () => {
    mockListOfficialMcpRegistry.mockResolvedValueOnce({
      entries: [
        {
          id: 'com.example/remote@1.0.0',
          name: 'Remote MCP',
          registryName: 'com.example/remote',
          description: 'Installable remote tools',
          version: '1.0.0',
          remotes: [
            {
              id: 'remote-1',
              type: 'streamable-http',
              url: 'https://example.com/mcp',
              label: 'HTTP mcp',
              headers: [],
              variables: [],
            },
          ],
        },
      ],
      nextCursor: null,
    });

    const { getAllByText, getByText, queryByText, rerender } = render(<McpStatusScreen />);
    await pressAndFlush(getByText('Browse'));

    await waitFor(() => expect(getByText('Remote MCP')).toBeTruthy());
    await pressAndFlush(getAllByText('Install')[0]);

    await waitFor(() => {
      expect(mockAddMcpServer).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalled();
    });
    rerender(<McpStatusScreen />);

    await waitFor(() => {
      expect(queryByText('No MCP servers')).toBeNull();
      expect(getByText('Remote MCP')).toBeTruthy();
    });
  });

  it('shows install progress banner and switches to installed during install', async () => {
    let resolveConnect: (() => void) | null = null;
    mockConnectServer.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    mockListOfficialMcpRegistry.mockResolvedValueOnce({
      entries: [
        {
          id: 'ai.com.mcp/petstore@0.6.0',
          name: 'Petstore MCP Server',
          registryName: 'ai.com.mcp/petstore',
          description: 'Demo MCP',
          version: '0.6.0',
          remotes: [
            {
              id: 'remote-1',
              type: 'streamable-http',
              url: 'https://petstore.run.mcp.com.ai/mcp',
              label: 'HTTP mcp',
              headers: [],
              variables: [],
            },
          ],
        },
      ],
      nextCursor: null,
    });

    const { getAllByText, getByText } = render(<McpStatusScreen />);
    await pressAndFlush(getByText('Browse'));
    await waitFor(() => expect(getByText('Petstore MCP Server')).toBeTruthy());

    await pressAndFlush(getAllByText('Install')[0]);

    await waitFor(() => {
      expect(getByText('Install Petstore MCP Server...')).toBeTruthy();
      expect(mockConnectServer).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveConnect?.();
      await flushAsyncInteractions();
    });

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  });

  it('starts OAuth automatically when install hits auth-required', async () => {
    mockListOfficialMcpRegistry.mockResolvedValueOnce({
      entries: [
        {
          id: 'com.example/oauth@1.0.0',
          name: 'OAuth MCP',
          registryName: 'com.example/oauth',
          description: 'Requires OAuth',
          version: '1.0.0',
          remotes: [
            {
              id: 'remote-1',
              type: 'streamable-http',
              url: 'https://oauth.example.com/mcp',
              label: 'HTTP mcp',
              headers: [],
              variables: [],
            },
          ],
        },
      ],
      nextCursor: null,
    });
    mockConnectServer.mockRejectedValueOnce(new Error('Authentication required'));
    mockGetStatus.mockReturnValue({
      id: 'oauth-generated',
      name: 'OAuth MCP',
      state: 'error',
      tools: [],
      authRequired: true,
      authState: 'unauthenticated',
      error: 'Authentication required.',
    });

    const { getAllByText, getByText } = render(<McpStatusScreen />);
    await pressAndFlush(getByText('Browse'));

    await waitFor(() => expect(getByText('OAuth MCP')).toBeTruthy());
    await pressAndFlush(getAllByText('Install')[0]);

    await waitFor(() => {
      expect(mockConnectServer).toHaveBeenCalledTimes(1);
      expect(mockAuthenticateServer).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalled();
    });
  });

  it('opens the install modal when required configuration is needed', async () => {
    mockListOfficialMcpRegistry.mockResolvedValueOnce({
      entries: [
        {
          id: 'com.example/secure@1.0.0',
          name: 'Secure MCP',
          registryName: 'com.example/secure',
          description: 'Needs an API key',
          version: '1.0.0',
          websiteUrl: 'https://example.com/secure',
          trust: {
            source: 'official-registry',
            registryName: 'com.example/secure',
            websiteUrl: 'https://example.com/secure',
          },
          capabilities: {
            transports: ['streamable-http'],
            authMode: 'header',
            requiresConfiguration: true,
            requiresSecrets: true,
            inputCount: 1,
          },
          remotes: [
            {
              id: 'remote-1',
              type: 'streamable-http',
              url: 'https://secure.example.com/mcp',
              label: 'HTTP mcp',
              headers: [
                {
                  key: 'Authorization',
                  label: 'Authorization',
                  kind: 'header',
                  required: true,
                  secret: true,
                },
              ],
              variables: [],
            },
          ],
        },
      ],
      nextCursor: null,
    });

    const { getAllByText, getByPlaceholderText, getByText } = render(<McpStatusScreen />);
    await pressAndFlush(getByText('Browse'));

    await waitFor(() => expect(getByText('Secure MCP')).toBeTruthy());
    await pressAndFlush(getAllByText('Install')[0]);

    await waitFor(() => {
      expect(getByText('Install MCP Server')).toBeTruthy();
      expect(getByText('Authorization *')).toBeTruthy();
      expect(getAllByText('Official registry').length).toBeGreaterThan(0);
      expect(getAllByText('Header auth').length).toBeGreaterThan(0);
      expect(getAllByText('Configuration required').length).toBeGreaterThan(0);
      expect(getAllByText('Secrets required').length).toBeGreaterThan(0);
      expect(getAllByText('Registry: com.example/secure').length).toBeGreaterThan(0);
      expect(getAllByText('Website: https://example.com/secure').length).toBeGreaterThan(0);
    });

    fireEvent.changeText(getByPlaceholderText('Authorization'), 'Bearer secret-key');
    await pressAndFlush(getAllByText('Install')[1]);

    await waitFor(() => {
      expect(mockAddMcpServer).toHaveBeenCalledTimes(1);
      expect(mockConnectServer).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalled();
    });
  });

  it('renders disconnected server with default status', async () => {
    mockMcpServers = [
      { id: 'srv2', name: 'Offline Server', url: 'https://off.com', enabled: true },
    ];
    mockGetStatus.mockReturnValue(undefined); // No status yet

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => {
      expect(getByText('Offline Server')).toBeTruthy();
      expect(getByText('disconnected')).toBeTruthy();
    });
  });

  it('renders server with many tools (shows +N more)', async () => {
    mockMcpServers = [{ id: 'srv3', name: 'Big Server', url: 'https://big.com', enabled: true }];
    const tools = Array.from({ length: 12 }, (_, i) => ({
      name: `tool_${i}`,
      description: `T${i}`,
    }));
    mockGetStatus.mockReturnValue({
      id: 'srv3',
      name: 'Big Server',
      state: 'connected',
      tools,
    });

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => {
      expect(getByText('tool_0')).toBeTruthy();
      expect(getByText('+4 more')).toBeTruthy();
    });
  });

  it('filters disabled servers', async () => {
    mockMcpServers = [
      { id: 'srv1', name: 'Enabled', url: 'https://a.com', enabled: true },
      { id: 'srv2', name: 'Disabled', url: 'https://b.com', enabled: false },
    ];
    mockGetStatus.mockReturnValue({
      id: 'srv1',
      name: 'Enabled',
      state: 'connected',
      tools: [],
    });

    const { getByText, queryByText } = render(<McpStatusScreen />);
    await waitFor(() => {
      expect(getByText('Enabled')).toBeTruthy();
      expect(queryByText('Disabled')).toBeNull();
    });
  });

  it('renders connecting state', async () => {
    mockMcpServers = [
      { id: 'srv1', name: 'Connecting Server', url: 'https://c.com', enabled: true },
    ];
    mockGetStatus.mockReturnValue({
      id: 'srv1',
      name: 'Connecting Server',
      state: 'connecting',
      tools: [],
    });

    const { getByText } = render(<McpStatusScreen />);
    await waitFor(() => {
      expect(getByText('connecting')).toBeTruthy();
    });
  });

  it('prompts for required remote configuration before installing', async () => {
    mockListOfficialMcpRegistry.mockResolvedValueOnce({
      entries: [
        {
          id: 'ai.adadvisor/mcp-server@1.0.0',
          name: 'AdAdvisor MCP Server',
          registryName: 'ai.adadvisor/mcp-server',
          description: 'AdAdvisor tools',
          version: '1.0.0',
          remotes: [
            {
              id: 'remote-1',
              type: 'streamable-http',
              url: 'https://api.adadvisor.ai/mcp',
              label: 'HTTP mcp',
              headers: [
                {
                  key: 'Authorization',
                  label: 'Authorization',
                  kind: 'header',
                  required: true,
                  secret: true,
                },
              ],
              variables: [],
            },
          ],
        },
      ],
      nextCursor: null,
    });

    const { getAllByText, getByText, queryByText } = render(<McpStatusScreen />);
    await pressAndFlush(getByText('Browse'));

    await waitFor(() => expect(getByText('AdAdvisor MCP Server')).toBeTruthy());
    await pressAndFlush(getAllByText('Install')[0]);

    await waitFor(() => {
      expect(getByText('Install MCP Server')).toBeTruthy();
      expect(getByText('Authorization *')).toBeTruthy();
    });

    expect(queryByText('No MCP servers')).toBeNull();
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(mockConnectServer).not.toHaveBeenCalled();
  });
});
