import { fireEvent, waitFor } from '@testing-library/react-native';

import {
  getInteractiveTerminalProps,
  mockNavigate,
  mockResolveWorkspaceTargetLaunch,
  mockRunExpoProjectAction,
  mockTerminalRef,
  mockWriteShellInput,
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
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });
});
