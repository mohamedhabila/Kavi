import { fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { createMcpServer } from '../helpers/remoteConfigFixtures';
import {
  renderSettingsScreen,
  settingsMocks,
  settingsTestState,
  setupSettingsScreenTestSuite,
} from './SettingsScreen.testSupport';

describe('SettingsScreen remote config', () => {
  setupSettingsScreenTestSuite();

  it('should navigate to MCP edit when server is tapped', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Edit MCP Server')).toBeTruthy();
    });
  });

  it('should navigate to new MCP edit when Plus button is tapped', () => {
    const { getByText, getByLabelText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add MCP server'));
    expect(getByText('Add MCP Server')).toBeTruthy();
  });

  it('should navigate to new SSH target edit when SSH plus button is tapped', () => {
    const { getByText, getByLabelText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add SSH target'));
    expect(getByText('Add SSH Target')).toBeTruthy();
  });

  it('should save a new SSH target', () => {
    const { getByText, getByLabelText, getByPlaceholderText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add SSH target'));
    fireEvent.changeText(getByPlaceholderText('ssh.example.com'), 'ssh.example.com');
    fireEvent.changeText(getByPlaceholderText('developer'), 'mohamed');
    fireEvent.changeText(getByPlaceholderText('SSH password'), 'top-secret');
    fireEvent.press(getByText('Save'));
    return waitFor(() => {
      expect(settingsMocks.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('ssh_password_'),
        'top-secret',
      );
      expect(settingsMocks.addSshTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'ssh.example.com',
          authMode: 'password',
          passwordRef: expect.stringContaining('ssh_password_'),
        }),
      );
    });
  });

  it('should save an SSH target with private key auth', async () => {
    const { getByText, getByLabelText, getByPlaceholderText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add SSH target'));
    fireEvent.changeText(getByPlaceholderText('ssh.example.com'), 'ssh.example.com');
    fireEvent.changeText(getByPlaceholderText('developer'), 'mohamed');
    fireEvent.press(getByText('Private key'));
    fireEvent.changeText(
      getByPlaceholderText('-----BEGIN OPENSSH PRIVATE KEY-----'),
      'PRIVATE KEY',
    );
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('ssh_private_key_'),
        'PRIVATE KEY',
      );
      expect(settingsMocks.addSshTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          authMode: 'private-key',
          privateKeyRef: expect.stringContaining('ssh_private_key_'),
        }),
      );
    });
  });

  it('should navigate to new workspace target edit when workspace plus button is tapped', () => {
    const { getByText, getByLabelText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add Workspace Target'));
    expect(getByText('Add Workspace Target')).toBeTruthy();
  });

  it('should save a new workspace target', () => {
    const { getByText, getByLabelText, getByPlaceholderText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add Workspace Target'));
    fireEvent.changeText(getByPlaceholderText('/Users/username/project'), '/tmp/project');
    fireEvent.press(getByText('Save'));
    return waitFor(() => {
      expect(settingsMocks.addWorkspaceTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          rootPath: '/tmp/project',
          provider: 'code-server',
          authMode: 'none',
        }),
      );
    });
  });

  it('should save a workspace access token securely when token auth is configured', async () => {
    const { getByText, getByLabelText, getByPlaceholderText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add Workspace Target'));
    fireEvent.changeText(getByPlaceholderText('/Users/username/project'), '/tmp/project');
    fireEvent.changeText(
      getByPlaceholderText('https://code.example.com'),
      'https://code.example.com',
    );
    fireEvent.press(getByText('Bearer token'));
    fireEvent.changeText(getByPlaceholderText('workspace token'), 'secret-token');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('workspace_access_token_'),
        'secret-token',
      );
      expect(settingsMocks.addWorkspaceTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://code.example.com',
          authMode: 'bearer',
          accessTokenRef: expect.stringContaining('workspace_access_token_'),
        }),
      );
    });
  });

  it('should show MCP edit form fields', async () => {
    const { getByText } = renderSettingsScreen();
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
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.updateMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          trust: { source: 'manual' },
          capabilities: expect.objectContaining({
            transport: 'auto',
            authMode: 'none',
            requiresConfiguration: false,
            requiresSecrets: false,
          }),
        }),
      );
    });
  });

  it('should let the user reset a stored OAuth session from MCP settings', async () => {
    const { hasStoredMcpOAuth, clearMcpOAuth } = require('../../src/services/mcp/oauth');
    hasStoredMcpOAuth.mockResolvedValue(true);
    settingsTestState.mcpServers = [
      createMcpServer({
        id: 'mcp1',
        name: 'Test MCP',
        url: 'https://mcp.test.com',
        oauth: { clientId: 'mobile-client' },
      }) as any,
    ];
    jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      const destructive = buttons?.find((button: any) => button.style === 'destructive');
      destructive?.onPress?.();
    });

    const { getByText } = renderSettingsScreen();
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
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Delete MCP Server')).toBeTruthy();
    });
  });

  it('should save MCP server and return to main', async () => {
    const { getByText } = renderSettingsScreen();
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
    const { getByText, getAllByTestId } = renderSettingsScreen();
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
    const { getByText } = renderSettingsScreen();
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

  it('should execute delete MCP server confirmation', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      const deleteBtn = buttons?.find((b: any) => b.style === 'destructive');
      deleteBtn?.onPress?.();
    });
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Delete MCP Server')).toBeTruthy();
    });
    fireEvent.press(getByText('Delete MCP Server'));
    expect(settingsMocks.removeMcpServer).toHaveBeenCalledWith('mcp1');
  });

  it('should save existing MCP server with updateMcpServer', async () => {
    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByText('Save')).toBeTruthy();
    });
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(settingsMocks.updateMcpServer).toHaveBeenCalled();
    });
  });

  it('should save new MCP server with addMcpServer', async () => {
    const { getByText, getByLabelText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Add MCP server'));
    expect(getByText('Add MCP Server')).toBeTruthy();
    fireEvent.press(getByText('Save'));
    await waitFor(() => {
      expect(settingsMocks.addMcpServer).toHaveBeenCalled();
    });
  });

  it('should edit MCP name field', async () => {
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByDisplayValue('Test MCP')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('Test MCP'), 'Renamed MCP');
    expect(getByDisplayValue('Renamed MCP')).toBeTruthy();
  });

  it('should edit MCP URL field', async () => {
    const { getByText, getByDisplayValue } = renderSettingsScreen();
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByDisplayValue('https://mcp.test.com')).toBeTruthy();
    });
    fireEvent.changeText(getByDisplayValue('https://mcp.test.com'), 'https://new-mcp.test.com');
    expect(getByDisplayValue('https://new-mcp.test.com')).toBeTruthy();
  });

  it('should edit MCP token field', async () => {
    const { getByText, getByPlaceholderText } = renderSettingsScreen();
    fireEvent.press(getByText('Test MCP'));
    await waitFor(() => {
      expect(getByPlaceholderText('Bearer token')).toBeTruthy();
    });
    fireEvent.changeText(getByPlaceholderText('Bearer token'), 'my-secret-token');
  });
});
