import { fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import {
  confirmRemoteWorkDestructiveAlert,
  getRemoteWorkSecureStorageMocks,
  getRemoteWorkSettingsState,
  renderRemoteWorkScreen,
  setupRemoteWorkScreenTestSuite,
} from './RemoteWorkScreen.testSupport';

describe('RemoteWorkScreen config validation', () => {
  setupRemoteWorkScreenTestSuite();
  it('requires a workspace root path before saving', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const { getAllByLabelText, getByLabelText } = renderRemoteWorkScreen();

    fireEvent.press(getAllByLabelText('Add Workspace Target')[0]);
    fireEvent.press(getByLabelText('Save workspace target'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addWorkspaceTarget).not.toHaveBeenCalled();
  });

  it('does not treat disabled linked workspaces as ready', () => {
    const state = getRemoteWorkSettingsState();
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

    const { getByText, queryByText } = renderRemoteWorkScreen();

    expect(getByText('0 ready')).toBeTruthy();
    expect(getByText('1 disabled')).toBeTruthy();
    expect(queryByText('AI handoff ready')).toBeNull();
  });

  it('does not surface stale linked browser or SSH ids in the workspace detail card', () => {
    const state = getRemoteWorkSettingsState();
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

    const { getAllByText, getByText, queryByText } = renderRemoteWorkScreen();

    expect(getAllByText('None').length).toBeGreaterThan(0);
    expect(getByText('Link an SSH target to enable Cursor CLI handoff')).toBeTruthy();
    expect(queryByText('missing-browser')).toBeNull();
    expect(queryByText('missing-ssh')).toBeNull();
  });

  it('falls back to the workspace root name when a saved target has no display name', () => {
    const state = getRemoteWorkSettingsState();
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

    const { getAllByText } = renderRemoteWorkScreen();

    expect(getAllByText('repo-name').length).toBeGreaterThan(0);
  });

  it('requires an SSH host before saving', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const { getByLabelText, getByText } = renderRemoteWorkScreen();

    fireEvent.press(getByLabelText('SSH targets'));
    fireEvent.press(getByLabelText('Add SSH target'));
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addSshTarget).not.toHaveBeenCalled();
  });

  it('requires a Browserbase project id before saving a browser provider', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const { getByLabelText, getByText } = renderRemoteWorkScreen();

    fireEvent.press(getByLabelText('Browser providers'));
    fireEvent.press(getByLabelText('Add Browser Provider'));
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addBrowserProvider).not.toHaveBeenCalled();
  });

  it('executes delete browser provider confirmation from the config studio', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    confirmRemoteWorkDestructiveAlert();

    const { getByLabelText } = renderRemoteWorkScreen();
    fireEvent.press(getByLabelText('Edit Browser Provider'));
    fireEvent.press(getByLabelText('Delete Browser Provider'));

    await waitFor(() => {
      expect(settingsState.removeBrowserProvider).toHaveBeenCalledWith('browser-1');
      expect(storage.deleteSecure).toHaveBeenCalledWith('browser_provider_api_key_browser-1');
    });
  });

  it('requires an Expo account owner before saving', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const { findByText, getAllByText, getByLabelText } = renderRemoteWorkScreen();

    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(await findByText('Add Expo account'));
    fireEvent.press(getAllByText('Save')[0]);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    });
    expect(settingsState.addExpoAccount).not.toHaveBeenCalled();
  });

  it('executes delete Expo account confirmation from the config studio', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const storage = getRemoteWorkSecureStorageMocks();
    confirmRemoteWorkDestructiveAlert();

    const { getByLabelText } = renderRemoteWorkScreen();
    fireEvent.press(getByLabelText('Edit Expo Project'));
    fireEvent.press(getByLabelText('Delete Expo Account'));

    await waitFor(() => {
      expect(settingsState.removeExpoAccount).toHaveBeenCalledWith('expo-account-1');
      expect(storage.deleteSecure).toHaveBeenCalledWith('expo_account_token_expo-account-1');
    });
  });

  it('requires a workflow file for GitHub workflow Expo projects', async () => {
    const settingsState = getRemoteWorkSettingsState();
    const { findByPlaceholderText, getAllByText, getByLabelText, getByText } =
      renderRemoteWorkScreen();

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
    const settingsState = getRemoteWorkSettingsState();
    const { findByPlaceholderText, getByLabelText, getByText } = renderRemoteWorkScreen();

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
