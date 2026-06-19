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
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ name: 'McpStatus' }),
  useFocusEffect: jest.fn(),
}));
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
