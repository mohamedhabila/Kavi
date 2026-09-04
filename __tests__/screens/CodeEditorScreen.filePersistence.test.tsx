// ---------------------------------------------------------------------------
// Tests — CodeEditorScreen file open/save workflows and their error handling
// ---------------------------------------------------------------------------
//
// Split out of CodeEditorScreen.test.tsx to stay under the maintainability
// line limit. Navigation/UI-state coverage lives there; both suites share
// fixtures and jest.mock registrations from
// __tests__/helpers/codeEditorScreenFixtures.tsx.

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import {
  mockCodeEditorScreenState,
  mockReadConversationWorkspaceTextFile,
  mockReadSshTextFile,
  mockReadWorkspaceFile,
  mockSettings,
  mockWriteConversationWorkspaceTextFile,
  mockWriteSshTextFile,
  mockWriteWorkspaceFile,
  resetCodeEditorScreenFixtures,
} from '../helpers/codeEditorScreenFixtures';
import { CodeEditorScreen } from '../../src/screens/CodeEditorScreen';

describe('CodeEditorScreen file persistence', () => {
  beforeEach(() => {
    resetCodeEditorScreenFixtures();
  });

  it('opens and saves a workspace file through the editor workflow', async () => {
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];

    const { getByText, getByDisplayValue, getByLabelText, getByTestId, queryByText } = render(
      <CodeEditorScreen />,
    );

    expect(getByTestId('code-editor-target-group').props.accessibilityRole).toBe('radiogroup');
    expect(getByTestId('code-editor-target-ws-1').props.accessibilityRole).toBe('radio');
    expect(getByTestId('code-editor-target-ws-1').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(
      StyleSheet.flatten(getByTestId('code-editor-target-ws-1').props.style).minHeight,
    ).toBe(48);
    expect(getByTestId('code-editor-browse-files').props.accessibilityLabel).toBe(
      'codeEditor.browseFiles',
    );
    expect(getByTestId('code-editor-browse-files').props.accessibilityState).toEqual({
      expanded: true,
    });

    await act(async () => {
      fireEvent.press(getByText('open-browser-file'));
    });

    await waitFor(() => {
      expect(mockReadWorkspaceFile).toHaveBeenCalledWith(
        mockSettings.workspaceTargets[0],
        '/workspace/project/src/App.tsx',
      );
    });

    expect(getByDisplayValue('/workspace/project/src/App.tsx')).toBeTruthy();
    fireEvent.press(getByText('set-fallback-mode'));
    expect(getByText('codeEditor.fallbackModeMessage')).toBeTruthy();
    expect(queryByText('codemirror-load-failed')).toBeNull();

    mockCodeEditorScreenState.editorContent = 'console.log(2);';
    fireEvent.press(getByText('mark-dirty'));
    fireEvent.press(getByLabelText('codeEditor.saveFile'));

    await waitFor(() => {
      expect(mockWriteWorkspaceFile).toHaveBeenCalledWith(
        mockSettings.workspaceTargets[0],
        '/workspace/project/src/App.tsx',
        'console.log(2);',
      );
    });
  });

  it('opens and saves a conversation workspace file through the editor workflow', async () => {
    mockCodeEditorScreenState.routeParams = {
      source: 'local',
      conversationId: 'conv-1',
      filePath: 'src/App.tsx',
      content: 'console.log(1);',
    };

    const { getAllByText, getByDisplayValue, getByLabelText, getByTestId, getByText } = render(
      <CodeEditorScreen />,
    );

    expect(getByDisplayValue('src/App.tsx')).toBeTruthy();
    expect(getAllByText('common.files').length).toBeGreaterThan(0);

    mockCodeEditorScreenState.editorContent = 'console.log(2);';
    fireEvent.press(getByText('mark-dirty'));
    fireEvent.press(getByLabelText('codeEditor.saveFile'));

    await waitFor(() => {
      expect(mockWriteConversationWorkspaceTextFile).toHaveBeenCalledWith(
        'conv-1',
        'src/App.tsx',
        'console.log(2);',
      );
    });

    expect(getByTestId('code-editor-reload-file').props.accessibilityLabel).toBe(
      'codeEditor.reloadFile',
    );
    fireEvent.press(getByTestId('code-editor-reload-file'));

    await waitFor(() => {
      expect(mockReadConversationWorkspaceTextFile).toHaveBeenCalledWith('conv-1', 'src/App.tsx');
    });
  });

  it('opens a workspace file from route params on mount and reloads it', async () => {
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];
    mockCodeEditorScreenState.routeParams = {
      source: 'workspace',
      targetId: 'ws-1',
      filePath: '/workspace/project/src/App.tsx',
    };

    const screen = render(<CodeEditorScreen />);

    const { getByDisplayValue, getByText } = screen;

    await waitFor(() => {
      expect(mockReadWorkspaceFile).toHaveBeenCalledWith(
        mockSettings.workspaceTargets[0],
        '/workspace/project/src/App.tsx',
      );
    });

    expect(getByDisplayValue('/workspace/project/src/App.tsx')).toBeTruthy();

    mockReadWorkspaceFile.mockClear();
    fireEvent.press(getByText('codeEditor.reloadFile'));

    await waitFor(() => {
      expect(mockReadWorkspaceFile).toHaveBeenCalledWith(
        mockSettings.workspaceTargets[0],
        '/workspace/project/src/App.tsx',
      );
    });
  });

  it('opens a file over SSH after switching sources', async () => {
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];
    mockSettings.sshTargets = [
      {
        id: 'ssh-1',
        name: 'SSH A',
        enabled: true,
      },
    ];

    const { getByText, getByDisplayValue, getByLabelText } = render(<CodeEditorScreen />);

    fireEvent.press(getByText('codeEditor.sshLabel'));
    await act(async () => {
      fireEvent.press(getByText('open-browser-file'));
    });

    await waitFor(() => {
      expect(mockReadSshTextFile).toHaveBeenCalledWith(mockSettings.sshTargets[0], './src/App.tsx');
    });

    expect(getByDisplayValue('./src/App.tsx')).toBeTruthy();

    mockCodeEditorScreenState.editorContent = 'console.log(2);';
    fireEvent.press(getByText('mark-dirty'));
    fireEvent.press(getByLabelText('codeEditor.saveFile'));

    await waitFor(() => {
      expect(mockWriteSshTextFile).toHaveBeenCalledWith(
        mockSettings.sshTargets[0],
        './src/App.tsx',
        'console.log(2);',
      );
    });

    expect(getByText('dev@example.com:22')).toBeTruthy();
  });

  it('creates a new remote file after confirming discard of unsaved changes', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((button: any) => button.style === 'destructive');
      destructive?.onPress?.();
    });
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];

    const { getByDisplayValue, getByText } = render(<CodeEditorScreen />);

    await act(async () => {
      fireEvent.press(getByText('open-browser-file'));
    });

    await waitFor(() => {
      expect(getByDisplayValue('/workspace/project/src/App.tsx')).toBeTruthy();
    });

    fireEvent.press(getByText('mark-dirty'));
    fireEvent.press(getByText('codeEditor.newFile'));

    expect(alertSpy).toHaveBeenCalledWith(
      'codeEditor.discardChangesTitle',
      'codeEditor.discardChangesMessage',
      expect.any(Array),
    );
    await waitFor(() => {
      expect(getByDisplayValue('/workspace/project/codeEditor.newFileName')).toBeTruthy();
    });
    alertSpy.mockRestore();
  });

  it('ignores stale remote file loads after the user resets the editor state', async () => {
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];

    let resolveRead: ((value: { path: string; content: string; size: number }) => void) | undefined;
    mockReadWorkspaceFile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );

    const { getByDisplayValue, getByText, queryByDisplayValue } = render(<CodeEditorScreen />);

    await act(async () => {
      fireEvent.press(getByText('open-browser-file'));
    });

    fireEvent.press(getByText('codeEditor.newFile'));
    expect(getByDisplayValue('/workspace/project/codeEditor.newFileName')).toBeTruthy();

    await act(async () => {
      resolveRead?.({
        path: '/workspace/project/src/App.tsx',
        content: 'console.log(99);',
        size: 16,
      });
      await Promise.resolve();
    });

    expect(getByDisplayValue('/workspace/project/codeEditor.newFileName')).toBeTruthy();
    expect(queryByDisplayValue('/workspace/project/src/App.tsx')).toBeNull();
  });

  it('shows an alert when opening a remote workspace file fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];
    mockReadWorkspaceFile.mockRejectedValueOnce(new Error('open boom'));

    const { getByText } = render(<CodeEditorScreen />);
    await act(async () => {
      fireEvent.press(getByText('open-browser-file'));
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'codeEditor.openFailedTitle',
        'codeEditor.openFailedMessage',
        undefined,
      );
    });
    alertSpy.mockRestore();
  });

  it('reveals the technical detail alongside the generic open-failure message in developer mode', async () => {
    mockSettings.developerModeEnabled = true;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];
    mockReadWorkspaceFile.mockRejectedValueOnce(new Error('open boom'));

    const { getByText } = render(<CodeEditorScreen />);
    await act(async () => {
      fireEvent.press(getByText('open-browser-file'));
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'codeEditor.openFailedTitle',
        expect.stringContaining('codeEditor.openFailedMessage'),
        undefined,
      );
      expect(alertSpy).toHaveBeenCalledWith(
        'codeEditor.openFailedTitle',
        expect.stringContaining('open boom'),
        undefined,
      );
    });
    mockSettings.developerModeEnabled = false;
    alertSpy.mockRestore();
  });

  it('shows an alert when saving a workspace file fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];
    mockWriteWorkspaceFile.mockRejectedValueOnce(new Error('save boom'));

    const { getByLabelText, getByText } = render(<CodeEditorScreen />);

    await act(async () => {
      fireEvent.press(getByText('open-browser-file'));
    });

    await waitFor(() => {
      expect(mockReadWorkspaceFile).toHaveBeenCalled();
    });

    mockCodeEditorScreenState.editorContent = 'console.log(3);';
    fireEvent.press(getByText('mark-dirty'));
    fireEvent.press(getByLabelText('codeEditor.saveFile'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'codeEditor.saveFailedTitle',
        'codeEditor.saveFailedMessage',
        undefined,
      );
    });
    alertSpy.mockRestore();
  });
});
