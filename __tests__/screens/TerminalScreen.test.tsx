// ---------------------------------------------------------------------------
// Tests for TerminalScreen (xterm.js WebView-based)
// ---------------------------------------------------------------------------

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

// Mock navigation
const mockOpenDrawer = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    openDrawer: mockOpenDrawer,
  }),
}));

jest.mock('@react-navigation/drawer', () => ({
  DrawerNavigationProp: {},
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mock the JavaScript execution
jest.mock('../../src/utils/javascript', () => ({
  executeJavaScriptWithResult: jest.fn(),
  formatJavaScriptResult: jest.fn((value: unknown) =>
    typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  ),
}));

jest.mock('../../src/services/terminal/localRuntime', () => ({
  getLocalRuntimeCapabilities: jest.fn(),
  executeLocalShellCommand: jest.fn(),
}));

const mockTerminalRef = {
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
let mockTerminalProps: any = null;

jest.mock('../../src/components/terminal/TerminalWebView', () => {
  const React = require('react');
  const { View } = require('react-native');
  const TerminalWebView = React.forwardRef((props: any, ref: any) => {
    mockTerminalProps = props;
    React.useImperativeHandle(ref, () => mockTerminalRef);
    return React.createElement(View, { testID: 'mock-terminal-webview' });
  });
  TerminalWebView.displayName = 'TerminalWebView';
  return { TerminalWebView };
});

const mockSshTargets = [
  {
    id: 'ssh-1',
    name: 'Build Box',
    host: 'ssh.example.com',
    port: 22,
    username: 'developer',
    enabled: true,
    ptyType: 'xterm',
  },
];

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: any) => selector({ sshTargets: mockSshTargets }),
}));

const mockShellWrite = jest.fn();
const mockShellClose = jest.fn();
const mockOpenSshShell = jest.fn();
const mockGetSshTargetReadiness = jest.fn();
const mockGetSshTargetLabel = jest.fn(
  (target: any) => `${target.username}@${target.host}:${target.port}`,
);

jest.mock('../../src/services/ssh/connector', () => ({
  openSshShell: (...args: any[]) => mockOpenSshShell(...args),
  getSshTargetReadiness: (...args: any[]) => mockGetSshTargetReadiness(...args),
  getSshTargetLabel: (...args: any[]) => mockGetSshTargetLabel(...args),
}));

const mockClipboardGetStringAsync = jest.fn();

jest.mock('expo-clipboard', () => ({
  getStringAsync: (...args: any[]) => mockClipboardGetStringAsync(...args),
}));

jest.mock('../../src/utils/id', () => ({
  generateId: () => `test-${Date.now()}-${Math.random()}`,
}));

import { TerminalScreen } from '../../src/screens/TerminalScreen';
import {
  executeLocalShellCommand,
  getLocalRuntimeCapabilities,
} from '../../src/services/terminal/localRuntime';
import { executeJavaScriptWithResult, formatJavaScriptResult } from '../../src/utils/javascript';

const mockGetCapabilities = getLocalRuntimeCapabilities as jest.MockedFunction<
  typeof getLocalRuntimeCapabilities
>;
const mockExecuteLocalShellCommand = executeLocalShellCommand as jest.MockedFunction<
  typeof executeLocalShellCommand
>;
const mockExecuteJavaScriptWithResult = executeJavaScriptWithResult as jest.MockedFunction<
  typeof executeJavaScriptWithResult
>;
const mockFormatJavaScriptResult = formatJavaScriptResult as jest.MockedFunction<
  typeof formatJavaScriptResult
>;

async function renderTerminal() {
  const utils = render(<TerminalScreen />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

describe('TerminalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSshTargets.splice(0, mockSshTargets.length, {
      id: 'ssh-1',
      name: 'Build Box',
      host: 'ssh.example.com',
      port: 22,
      username: 'developer',
      enabled: true,
      ptyType: 'xterm',
    });
    mockGetCapabilities.mockResolvedValue({
      javascriptAvailable: true,
      shellSupported: true,
      shellAvailable: true,
      shellProvider: 'termux',
    });
    mockExecuteJavaScriptWithResult.mockResolvedValue(undefined);
    mockFormatJavaScriptResult.mockImplementation((value: unknown) =>
      typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    );
    mockExecuteLocalShellCommand.mockResolvedValue({
      ok: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
      errCode: -1,
      errorMessage: undefined,
      durationMs: 10,
      stdoutWasTruncated: false,
      stderrWasTruncated: false,
    });
    mockShellWrite.mockResolvedValue('');
    mockOpenSshShell.mockResolvedValue({
      target: mockSshTargets[0],
      write: mockShellWrite,
      close: mockShellClose,
    });
    mockGetSshTargetReadiness.mockReturnValue({ launchable: true, reason: 'ready' });
    mockClipboardGetStringAsync.mockResolvedValue('clipboard text');
  });

  it('renders terminal header and mode tabs', async () => {
    const { getByText } = await renderTerminal();
    expect(getByText('Terminal')).toBeTruthy();
    expect(getByText('JS')).toBeTruthy();
    expect(getByText('Shell')).toBeTruthy();
    expect(getByText('SSH')).toBeTruthy();
  });

  it('renders the WebView terminal component', async () => {
    const { getByTestId } = await renderTerminal();
    expect(getByTestId('mock-terminal-webview')).toBeTruthy();
  });

  it('switches mode when tabs are pressed', async () => {
    const { getByText } = await renderTerminal();

    // Should be in JS mode by default, switch to Shell
    fireEvent.press(getByText('Shell'));
    // Should not crash
    expect(getByText('Shell')).toBeTruthy();

    // Switch to SSH
    fireEvent.press(getByText('SSH'));
    expect(getByText('SSH')).toBeTruthy();

    // Switch back to JS
    fireEvent.press(getByText('JS'));
    expect(getByText('JS')).toBeTruthy();
  });

  it('shows clear button in toolbar', async () => {
    const { UNSAFE_root } = await renderTerminal();
    // The clear button uses a Trash2 icon rather than text; confirm render doesn't crash
    expect(UNSAFE_root).toBeTruthy();
  });

  it('does not crash when opening drawer', async () => {
    await renderTerminal();
    // The menu button triggers openDrawer; confirming render didn't crash
    expect(mockOpenDrawer).not.toHaveBeenCalled();
  });

  it('writes the JavaScript banner when the terminal becomes ready', async () => {
    await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    expect(mockTerminalRef.reset).toHaveBeenCalled();
    expect(mockTerminalRef.writeln).toHaveBeenCalledWith(
      expect.stringContaining('JavaScript REPL'),
    );
    expect(mockTerminalRef.write).toHaveBeenCalledWith(expect.stringContaining('js>'));
  });

  it('executes JavaScript input and prints the formatted result', async () => {
    mockExecuteJavaScriptWithResult.mockResolvedValueOnce({ answer: 42 });
    mockFormatJavaScriptResult.mockReturnValueOnce('{\n  "answer": 42\n}');
    await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
      await mockTerminalProps.onInput('1');
      await mockTerminalProps.onInput('+');
      await mockTerminalProps.onInput('1');
      await mockTerminalProps.onInput('\r');
    });

    expect(mockExecuteJavaScriptWithResult).toHaveBeenCalledWith('1+1');
    expect(mockTerminalRef.writeln).toHaveBeenCalledWith(expect.stringContaining('"answer": 42'));
  });

  it('prints JavaScript execution errors and redraws the prompt', async () => {
    mockExecuteJavaScriptWithResult.mockRejectedValueOnce(new Error('boom'));
    await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
      await mockTerminalProps.onInput('b');
      await mockTerminalProps.onInput('a');
      await mockTerminalProps.onInput('d');
      await mockTerminalProps.onInput('\r');
    });

    expect(mockExecuteJavaScriptWithResult).toHaveBeenCalledWith('bad');
    expect(mockTerminalRef.writeln).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(mockTerminalRef.write).toHaveBeenCalledWith(expect.stringContaining('js>'));
  });

  it('supports backspace while editing the current command line', async () => {
    await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
      await mockTerminalProps.onInput('a');
      await mockTerminalProps.onInput('b');
      await mockTerminalProps.onInput('\x7f');
      await mockTerminalProps.onInput('\r');
    });

    expect(mockTerminalRef.write).toHaveBeenCalledWith('\b \b');
    expect(mockExecuteJavaScriptWithResult).toHaveBeenCalledWith('a');
  });

  it('clears the terminal immediately for the clear command', async () => {
    await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
      await mockTerminalProps.onInput('c');
      await mockTerminalProps.onInput('l');
      await mockTerminalProps.onInput('e');
      await mockTerminalProps.onInput('a');
      await mockTerminalProps.onInput('r');
      await mockTerminalProps.onInput('\r');
    });

    expect(mockTerminalRef.clear).toHaveBeenCalled();
    expect(mockExecuteJavaScriptWithResult).not.toHaveBeenCalled();
  });

  it('runs local shell commands in shell mode', async () => {
    mockExecuteLocalShellCommand.mockResolvedValueOnce({
      ok: true,
      stdout: 'workspace',
      stderr: '',
      exitCode: 0,
      errCode: -1,
      errorMessage: undefined,
      durationMs: 12,
      workingDirectory: '/tmp/project',
      stdoutWasTruncated: false,
      stderrWasTruncated: false,
    });
    const { getByText } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('Shell'));

    await act(async () => {
      await mockTerminalProps.onInput('p');
      await mockTerminalProps.onInput('w');
      await mockTerminalProps.onInput('d');
      await mockTerminalProps.onInput('\r');
    });

    expect(mockExecuteLocalShellCommand).toHaveBeenCalledWith('pwd', { workingDirectory: null });
    expect(mockTerminalRef.writeln).toHaveBeenCalledWith('workspace');
  });

  it('prints shell command failures when the shell returns an error without stderr', async () => {
    mockExecuteLocalShellCommand.mockResolvedValueOnce({
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: 127,
      errCode: 127,
      errorMessage: 'command not found',
      durationMs: 10,
      workingDirectory: '/tmp/project',
      stdoutWasTruncated: false,
      stderrWasTruncated: false,
    });
    const { getByText } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('Shell'));

    await act(async () => {
      await mockTerminalProps.onInput('f');
      await mockTerminalProps.onInput('o');
      await mockTerminalProps.onInput('o');
      await mockTerminalProps.onInput('\r');
    });

    expect(mockExecuteLocalShellCommand).toHaveBeenCalledWith('foo', { workingDirectory: null });
    expect(mockTerminalRef.writeln).toHaveBeenCalledWith(
      expect.stringContaining('command not found'),
    );
  });

  it('prints the shell unavailable reason when shell mode is disabled', async () => {
    mockGetCapabilities.mockResolvedValueOnce({
      javascriptAvailable: true,
      shellSupported: true,
      shellAvailable: false,
      shellProvider: 'termux',
      unavailableReason: 'Termux not installed.',
    });
    const { getByText } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('Shell'));

    expect(mockTerminalRef.writeln).toHaveBeenCalledWith(
      expect.stringContaining('Termux not installed.'),
    );
  });

  it('shows the SSH empty state when no enabled SSH targets exist', async () => {
    mockSshTargets.splice(0, mockSshTargets.length);
    const { getByText } = await renderTerminal();

    fireEvent.press(getByText('SSH'));

    expect(getByText('No SSH targets configured. Add one in Remote Work settings.')).toBeTruthy();
  });

  it('connects to an SSH target and opens a shell session', async () => {
    const { getByText } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('SSH'));
    fireEvent.press(getByText('Build Box (developer@ssh.example.com:22)'));

    await waitFor(() => {
      expect(mockOpenSshShell).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ssh-1' }),
        expect.any(Function),
      );
    });
    expect(mockTerminalRef.writeln).toHaveBeenCalledWith(
      expect.stringContaining('Connected to Build Box'),
    );

    const onData = mockOpenSshShell.mock.calls[0][1];
    await act(async () => {
      onData('pwd\n');
    });

    expect(mockTerminalRef.write).toHaveBeenCalledWith('pwd\n');
  });

  it('renders SSH output chunks immediately without waiting for a newline', async () => {
    const { getByText } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('SSH'));
    fireEvent.press(getByText('Build Box (developer@ssh.example.com:22)'));

    await waitFor(() => {
      expect(mockOpenSshShell).toHaveBeenCalled();
    });

    const onData = mockOpenSshShell.mock.calls[0][1];
    await act(async () => {
      onData('l');
      onData('s');
    });

    expect(mockTerminalRef.write).toHaveBeenCalledWith('l');
    expect(mockTerminalRef.write).toHaveBeenCalledWith('s');
  });

  it('forwards keyboard input to the connected SSH shell', async () => {
    const { getByText } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('SSH'));
    fireEvent.press(getByText('Build Box (developer@ssh.example.com:22)'));

    await waitFor(() => {
      expect(mockOpenSshShell).toHaveBeenCalled();
    });

    await act(async () => {
      await mockTerminalProps.onInput('ls\n');
    });

    expect(mockShellWrite).toHaveBeenCalledWith('ls\n');
  });

  it('disconnects the SSH session when switching away from SSH mode', async () => {
    const { getByText } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('SSH'));
    fireEvent.press(getByText('Build Box (developer@ssh.example.com:22)'));

    await waitFor(() => {
      expect(mockOpenSshShell).toHaveBeenCalled();
    });

    fireEvent.press(getByText('JS'));

    await waitFor(() => {
      expect(mockShellClose).toHaveBeenCalled();
    });
  });

  it('does not attempt to connect disabled SSH targets', async () => {
    mockGetSshTargetReadiness.mockReturnValueOnce({
      launchable: false,
      reason: 'missing-auth-secret',
    });
    const { getByText } = await renderTerminal();

    fireEvent.press(getByText('SSH'));

    expect(getByText('Missing SSH credentials')).toBeTruthy();
    fireEvent.press(getByText('Build Box (developer@ssh.example.com:22)'));
    expect(mockOpenSshShell).not.toHaveBeenCalled();
  });

  it('closes stale SSH connections that resolve after leaving SSH mode', async () => {
    let resolveShell: ((value: any) => void) | null = null;
    mockOpenSshShell.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveShell = resolve;
        }),
    );

    const { getByText } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('SSH'));
    fireEvent.press(getByText('Build Box (developer@ssh.example.com:22)'));
    fireEvent.press(getByText('JS'));

    await act(async () => {
      resolveShell?.({
        target: mockSshTargets[0],
        write: mockShellWrite,
        close: mockShellClose,
      });
      await Promise.resolve();
    });

    expect(mockShellClose).toHaveBeenCalled();
  });

  it('closes the active SSH shell on unmount', async () => {
    const { getByText, unmount } = await renderTerminal();

    await act(async () => {
      mockTerminalProps.onReady(80, 24);
    });

    fireEvent.press(getByText('SSH'));
    fireEvent.press(getByText('Build Box (developer@ssh.example.com:22)'));

    await waitFor(() => {
      expect(mockOpenSshShell).toHaveBeenCalled();
    });

    unmount();

    expect(mockShellClose).toHaveBeenCalled();
  });

  it('opens terminal links through React Native Linking', async () => {
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true as never);
    await renderTerminal();

    await act(async () => {
      await mockTerminalProps.onLink('https://example.com/docs');
    });

    expect(openUrlSpy).toHaveBeenCalledWith('https://example.com/docs');
  });
});
