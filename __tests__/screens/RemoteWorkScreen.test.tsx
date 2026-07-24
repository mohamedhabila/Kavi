import { fireEvent, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  getInteractiveTerminalProps,
  mockNavigate,
  mockResolveWorkspaceTargetLaunch,
  mockRunExpoProjectAction,
  mockTerminalRef,
  mockWriteShellInput,
  getRemoteWorkSettingsState,
  mockRemoteWorkTestState,
  renderRemoteWorkScreen,
  setupRemoteWorkScreenTestSuite,
} from './RemoteWorkScreen.testSupport';

describe('RemoteWorkScreen runtime', () => {
  setupRemoteWorkScreenTestSuite();

  it('renders the remote work dashboard', () => {
    const { getByText, getAllByText } = renderRemoteWorkScreen();
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

  it('replaces repeated zero dashboards with one guided setup journey', () => {
    const state = getRemoteWorkSettingsState();
    Object.assign(state, {
      workspaceTargets: [],
      defaultWorkspaceTargetId: null,
      sshTargets: [],
      browserProviders: [],
      mcpServers: [],
      expoAccounts: [],
      expoProjects: [],
    });
    mockRemoteWorkTestState.sshSessions = {};

    const { getByTestId, getByText, queryByText } = renderRemoteWorkScreen();

    expect(getByTestId('remote-work-setup-guide')).toBeTruthy();
    expect(getByText('Connect where your work lives')).toBeTruthy();
    expect(getByText('Connected workspace')).toBeTruthy();
    expect(getByText('SSH server')).toBeTruthy();
    expect(getByText('Hosted browser')).toBeTruthy();
    expect(queryByText('Remote execution surfaces')).toBeNull();
    expect(queryByText('No remote workspaces configured')).toBeNull();
    expect(
      StyleSheet.flatten(getByTestId('remote-work-setup-workspace').props.style).minHeight,
    ).toBe(76);

    fireEvent.press(getByTestId('remote-work-setup-workspace'));
    expect(getByText('Add workspace target')).toBeTruthy();
  });

  it('gives both header actions a full touch target', () => {
    const { getByLabelText } = renderRemoteWorkScreen();

    expect(StyleSheet.flatten(getByLabelText('Back').props.style)).toMatchObject({
      minHeight: 44,
      width: 44,
    });
    expect(StyleSheet.flatten(getByLabelText('Open Settings').props.style)).toMatchObject({
      minHeight: 44,
      width: 44,
    });
  });

  it('runs an Expo build action', async () => {
    const { getByText } = renderRemoteWorkScreen();
    fireEvent.press(getByText('Build Android'));

    await waitFor(() => {
      expect(mockRunExpoProjectAction).toHaveBeenCalledWith('expo-project-1', 'build', {
        platform: 'android',
      });
    });
  });

  it('runs iOS build and submit actions for Expo projects', async () => {
    const { getByText } = renderRemoteWorkScreen();

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
    const { getByText, getByTestId } = renderRemoteWorkScreen();
    fireEvent.press(getByText('Launch Workspace'));

    await waitFor(() => {
      expect(mockResolveWorkspaceTargetLaunch).toHaveBeenCalled();
      expect(getByTestId('remote-workspace-webview')).toBeTruthy();
    });
  });

  it('runs a connection probe and renders the result', async () => {
    const { getAllByText, findAllByText } = renderRemoteWorkScreen();
    fireEvent.press(getAllByText('Check connection')[0]);
    expect((await findAllByText('Ready (200)')).length).toBeGreaterThan(0);
  });

  it('opens an SSH shell session modal', async () => {
    const { findByTestId, getByText } = renderRemoteWorkScreen();
    fireEvent.press(getByText('Resume Shell'));

    expect(await findByTestId('mock-interactive-terminal-surface')).toBeTruthy();

    getInteractiveTerminalProps()?.onReady?.(80, 24);

    await waitFor(() => {
      expect(mockTerminalRef.write).toHaveBeenCalledWith('$ pwd\n/home/user\n');
    });
  });

  it('forwards raw terminal input to the active SSH session', async () => {
    const { findByTestId, getByText } = renderRemoteWorkScreen();
    fireEvent.press(getByText('Resume Shell'));
    expect(await findByTestId('mock-interactive-terminal-surface')).toBeTruthy();

    await waitFor(() => {
      expect(getInteractiveTerminalProps()).toBeTruthy();
    });

    await getInteractiveTerminalProps()?.onInput?.('l');

    expect(mockWriteShellInput).toHaveBeenCalledWith('ssh-session-1', 'l');
  });

  it('navigates to settings from the header action', () => {
    const { getByLabelText } = renderRemoteWorkScreen();
    fireEvent.press(getByLabelText('Open Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings', {
      destination: 'home',
      returnTo: { name: 'RemoteWork' },
    });
  });
});
