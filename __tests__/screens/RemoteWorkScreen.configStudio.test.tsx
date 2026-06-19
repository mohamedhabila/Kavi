import { fireEvent, waitFor } from '@testing-library/react-native';

import {
  confirmRemoteWorkDestructiveAlert,
  getRemoteWorkSecureStorageMocks,
  getRemoteWorkSettingsState,
  mockClearMcpOAuth,
  mockGetSecure,
  mockHasStoredMcpOAuth,
  mockSyncExpoAccountProjects,
  renderRemoteWorkScreen,
  setupRemoteWorkScreenTestSuite,
} from './RemoteWorkScreen.testSupport';

describe('RemoteWorkScreen config studio', () => {
  setupRemoteWorkScreenTestSuite();

  it('shows all five configuration studio surfaces', () => {
    const { getByLabelText } = renderRemoteWorkScreen();
    expect(getByLabelText('Ready workspaces')).toBeTruthy();
    expect(getByLabelText('SSH targets')).toBeTruthy();
    expect(getByLabelText('Browser providers')).toBeTruthy();
    expect(getByLabelText('Expo / EAS')).toBeTruthy();
    expect(getByLabelText('MCP servers')).toBeTruthy();
  });

  it('switches to the Expo surface and opens the explicit editor', async () => {
    const { findByText, getByLabelText } = renderRemoteWorkScreen();
    fireEvent.press(getByLabelText('Expo / EAS'));
    fireEvent.press(getByLabelText('Add Expo project'));

    expect(await findByText('Expo Accounts')).toBeTruthy();
    expect(await findByText('Expo Projects')).toBeTruthy();
  });

  it('shows the richer Expo project fields used in Settings', async () => {
    const { findByText, getByLabelText, getByText, queryByText } = renderRemoteWorkScreen();

    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(getByText('GitHub Workflow'));

    expect(await findByText('Workflow Ref')).toBeTruthy();
    expect(getByText('Update Channel')).toBeTruthy();
    expect(getByText('Preview URL')).toBeTruthy();
    expect(getByText('Custom Domain')).toBeTruthy();
    expect(queryByText('Robot / CI')).toBeTruthy();
  });

  it('syncs Expo projects from the Remote Work editor', async () => {
    const { getAllByLabelText, getByLabelText } = renderRemoteWorkScreen();

    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(getAllByLabelText('Refresh')[0]);

    await waitFor(() => {
      expect(mockSyncExpoAccountProjects).toHaveBeenCalledWith('expo-account-1');
    });
  });

  it('switches to the MCP surface and opens the explicit editor', async () => {
    const { findByPlaceholderText, getByLabelText } = renderRemoteWorkScreen();
    fireEvent.press(getByLabelText('MCP servers'));
    fireEvent.press(getByLabelText('Add MCP server'));

    expect(await findByPlaceholderText('Server name')).toBeTruthy();
  });

  it('has Edit buttons on MCP target cards', () => {
    const { getByLabelText } = renderRemoteWorkScreen();
    expect(getByLabelText('Edit MCP Server')).toBeTruthy();
  });

  it('has Edit buttons on Expo project cards', () => {
    const { getByLabelText } = renderRemoteWorkScreen();
    expect(getByLabelText('Edit Expo Project')).toBeTruthy();
  });

  it('opens an explicit workspace editor modal when editing a target', async () => {
    const { findByText, getAllByLabelText } = renderRemoteWorkScreen();

    fireEvent.press(getAllByLabelText('Edit Workspace Target')[0]);

    expect(await findByText('Edit workspace target: Main Repo')).toBeTruthy();
    expect(await findByText('Basics')).toBeTruthy();
  });

  it('loads the stored workspace access token when editing an existing target', async () => {
    const settingsState = getRemoteWorkSettingsState();
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

    const { findByDisplayValue, getAllByLabelText } = renderRemoteWorkScreen();

    fireEvent.press(getAllByLabelText('Edit Workspace Target')[0]);

    await waitFor(() => {
      expect(mockGetSecure).toHaveBeenCalledWith('workspace_access_token_ws-1');
    });
    expect(await findByDisplayValue('workspace-secret')).toBeTruthy();
  });

  it('saves a new workspace target with a bearer token', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    const { findByPlaceholderText, getAllByLabelText, getByLabelText, getByText } =
      renderRemoteWorkScreen();

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
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    confirmRemoteWorkDestructiveAlert();

    const { findByText, getAllByLabelText, getByLabelText } = renderRemoteWorkScreen();
    fireEvent.press(getAllByLabelText('Edit Workspace Target')[0]);
    expect(await findByText('Edit workspace target: Main Repo')).toBeTruthy();
    fireEvent.press(getByLabelText('Delete Workspace Target'));

    await waitFor(() => {
      expect(settingsState.removeWorkspaceTarget).toHaveBeenCalledWith('ws-1');
      expect(storage.deleteSecure).toHaveBeenCalledWith('workspace_access_token_ws-1');
    });
  });

  it('saves a new SSH target with private-key authentication', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    const { findByPlaceholderText, getByLabelText, getByText } = renderRemoteWorkScreen();

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
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    const { findByPlaceholderText, getByLabelText, getByText } = renderRemoteWorkScreen();

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

    const { findByDisplayValue, getByLabelText } = renderRemoteWorkScreen();

    fireEvent.press(getByLabelText('Edit Browser Provider'));

    await waitFor(() => {
      expect(mockGetSecure).toHaveBeenCalledWith('browser_provider_api_key_browser-1');
    });
    expect(await findByDisplayValue('browser-secret')).toBeTruthy();
  });

  it('saves a new Expo account and syncs its projects', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    const {
      findByPlaceholderText,
      findByText,
      getAllByPlaceholderText,
      getAllByText,
      getByLabelText,
      getByPlaceholderText,
    } = renderRemoteWorkScreen();

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
    const settingsState = getRemoteWorkSettingsState();
    const { findByPlaceholderText, getAllByText, getByLabelText, getByText } =
      renderRemoteWorkScreen();

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
    const settingsState = getRemoteWorkSettingsState();
    confirmRemoteWorkDestructiveAlert();

    const { getByLabelText } = renderRemoteWorkScreen();
    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(getByLabelText('Delete Expo Project'));

    await waitFor(() => {
      expect(settingsState.removeExpoProject).toHaveBeenCalledWith('expo-project-1');
    });
  });

  it('saves a new MCP server with a stored auth token', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    const { findByPlaceholderText, getByLabelText, getByText } = renderRemoteWorkScreen();

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
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    confirmRemoteWorkDestructiveAlert();

    const { findByLabelText, getByLabelText } = renderRemoteWorkScreen();
    fireEvent.press(getByLabelText('Edit MCP Server'));
    fireEvent.press(await findByLabelText('Delete MCP Server'));

    await waitFor(() => {
      expect(settingsState.removeMcpServer).toHaveBeenCalledWith('mcp-1');
      expect(storage.deleteSecure).toHaveBeenCalledWith('mcp_server_token_mcp-1');
    });
  });

  it('resets a stored OAuth session from the MCP editor', async () => {
    const settingsState = getRemoteWorkSettingsState();
    settingsState.mcpServers = [
      {
        ...settingsState.mcpServers[0],
        oauth: { clientId: 'mobile-client' },
      },
    ];
    mockHasStoredMcpOAuth.mockResolvedValue(true);
    confirmRemoteWorkDestructiveAlert();

    const { getByLabelText, getByText } = renderRemoteWorkScreen();
    fireEvent.press(getByLabelText('Edit MCP Server'));

    await waitFor(() => {
      expect(getByText('OAuth session saved')).toBeTruthy();
      expect(getByText('Reset OAuth session')).toBeTruthy();
    });

    fireEvent.press(getByText('Reset OAuth session'));

    await waitFor(() => {
      expect(mockClearMcpOAuth).toHaveBeenCalledWith('mcp-1');
    });
  });
});
