import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CodeEditorScreen } from '../../src/screens/CodeEditorScreen';

const mockNavigate = jest.fn();
const mockHandleBack = jest.fn();
const mockUseBackToChat = jest.fn(() => mockHandleBack);
const mockTranslate = (key: string) => (key === 'common.back' ? 'Back' : key);
let mockRouteParams: any = {};

const mockSettings = {
  sshTargets: [] as any[],
  workspaceTargets: [] as any[],
};

const mockReadWorkspaceFile = jest.fn();
const mockWriteWorkspaceFile = jest.fn();
const mockListWorkspaceDirectory = jest
  .fn()
  .mockResolvedValue({ path: '/workspace/project', entries: [] });
const mockReadConversationWorkspaceTextFile = jest.fn();
const mockWriteConversationWorkspaceTextFile = jest.fn();
const mockReadSshTextFile = jest.fn();
const mockWriteSshTextFile = jest.fn();
const mockListSshDirectory = jest.fn().mockResolvedValue([]);
let mockBrowserSelectedPath: string | null = null;

let mockEditorContent = '';
const mockSetEditorReadOnly = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@react-navigation/drawer', () => ({
  DrawerNavigationProp: {},
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      panel: '#111',
      border: '#333',
      header: '#18181b',
      text: '#fff',
      textSecondary: '#bbb',
      textTertiary: '#888',
      primary: '#22c55e',
      primarySoft: '#123524',
      onPrimary: '#fff',
      danger: '#ef4444',
      warning: '#f59e0b',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/i18n', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(View, { ...props, ref, testID: `icon-${name}` }),
    );
  return {
    ArrowLeft: icon('ArrowLeft'),
    Menu: icon('Menu'),
    Save: icon('Save'),
    FileCode: icon('FileCode'),
    FolderOpen: icon('FolderOpen'),
    Eye: icon('Eye'),
    Edit3: icon('Edit3'),
    RefreshCw: icon('RefreshCw'),
    FolderTree: icon('FolderTree'),
    PlusSquare: icon('PlusSquare'),
  };
});

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: any) => selector(mockSettings),
}));

jest.mock('../../src/components/files/FileBrowser', () => {
  const React = require('react');
  const { TouchableOpacity, Text, View } = require('react-native');
  return {
    FileBrowser: ({ onFileSelect, rootPath }: any) => (
      <View>
        <TouchableOpacity
          onPress={() => {
            const selectedPath =
              mockBrowserSelectedPath ??
              (rootPath === '.'
                ? './src/App.tsx'
                : `${String(rootPath).replace(/\/+$/g, '')}/src/App.tsx`);
            onFileSelect(selectedPath, { name: 'App.tsx', isDirectory: false });
          }}
        >
          <Text>open-browser-file</Text>
        </TouchableOpacity>
      </View>
    ),
  };
});

jest.mock('../../src/components/editor/CodeEditorWebView', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');

  const CodeEditorWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(
      ref,
      () => ({
        getContent: () => props.onContent?.(mockEditorContent || props.initialContent || ''),
        setContent: jest.fn(),
        setLanguage: jest.fn(),
        setReadOnly: mockSetEditorReadOnly,
        focus: jest.fn(),
        scrollToLine: jest.fn(),
        markClean: () => props.onDirtyChange?.(false),
      }),
      [props],
    );

    return (
      <View testID="mock-code-editor">
        <Text>{props.initialContent}</Text>
        <TouchableOpacity onPress={() => props.onDirtyChange?.(true)}>
          <Text>mark-dirty</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => props.onContent?.(mockEditorContent || props.initialContent || '')}
        >
          <Text>emit-editor-content</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => props.onModeChange?.('fallback', 'codemirror-load-failed')}
        >
          <Text>set-fallback-mode</Text>
        </TouchableOpacity>
      </View>
    );
  });

  return {
    CodeEditorWebView,
    detectEditorLanguage: (filename: string) =>
      filename.endsWith('.tsx') ? 'tsx' : filename.endsWith('.ts') ? 'typescript' : null,
  };
});

jest.mock('../../src/services/workspaces/files', () => ({
  readWorkspaceFile: (...args: any[]) => mockReadWorkspaceFile(...args),
  writeWorkspaceFile: (...args: any[]) => mockWriteWorkspaceFile(...args),
  listWorkspaceDirectory: (...args: any[]) => mockListWorkspaceDirectory(...args),
}));

jest.mock('../../src/services/conversationWorkspace/files', () => ({
  readConversationWorkspaceTextFile: (...args: any[]) =>
    mockReadConversationWorkspaceTextFile(...args),
  writeConversationWorkspaceTextFile: (...args: any[]) =>
    mockWriteConversationWorkspaceTextFile(...args),
}));

jest.mock('../../src/services/workspaces/connector', () => ({
  getWorkspaceProviderLabel: () => 'code-server',
}));

jest.mock('../../src/services/ssh/connector', () => ({
  getSshTargetLabel: () => 'dev@example.com:22',
  listSshDirectory: (...args: any[]) => mockListSshDirectory(...args),
  readSshTextFile: (...args: any[]) => mockReadSshTextFile(...args),
  writeSshTextFile: (...args: any[]) => mockWriteSshTextFile(...args),
}));

jest.mock('../../src/navigation/useBackToChat', () => ({
  useBackToChat: (...args: any[]) => mockUseBackToChat(...args),
}));

describe('CodeEditorScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    mockSettings.sshTargets = [];
    mockSettings.workspaceTargets = [];
    mockEditorContent = '';
    mockBrowserSelectedPath = null;
    mockSetEditorReadOnly.mockReset();
    mockHandleBack.mockReset();
    mockUseBackToChat.mockReset();
    mockUseBackToChat.mockImplementation(() => mockHandleBack);
    mockReadWorkspaceFile.mockResolvedValue({
      path: '/workspace/project/src/App.tsx',
      content: 'console.log(1);',
      size: 15,
    });
    mockReadConversationWorkspaceTextFile.mockResolvedValue({
      path: 'src/App.tsx',
      content: 'console.log(1);',
      size: 15,
      uri: 'file:///mock/document/workspace/conv-1/src/App.tsx',
    });
    mockReadSshTextFile.mockResolvedValue('console.log(1);');
    mockWriteWorkspaceFile.mockResolvedValue({ path: '/workspace/project/src/App.tsx', size: 15 });
    mockWriteConversationWorkspaceTextFile.mockResolvedValue({
      path: 'src/App.tsx',
      size: 15,
      uri: 'file:///mock/document/workspace/conv-1/src/App.tsx',
    });
    mockWriteSshTextFile.mockResolvedValue({ path: '/remote/project/src/App.tsx', size: 15 });
  });

  it('shows setup guidance when no remote targets are configured', () => {
    const { getByText } = render(<CodeEditorScreen />);

    expect(getByText('codeEditor.startEditingTitle')).toBeTruthy();
    fireEvent.press(getByText('codeEditor.openRemoteWork'));
    expect(mockNavigate).toHaveBeenCalledWith('RemoteWork');
  });

  it('routes header back through the shared back handler with discard interception', () => {
    const { getByLabelText } = render(<CodeEditorScreen />);

    fireEvent.press(getByLabelText('Back'));

    expect(mockUseBackToChat).toHaveBeenCalledWith(
      expect.objectContaining({ beforeNavigate: expect.any(Function) }),
    );
    expect(mockHandleBack).toHaveBeenCalledTimes(1);
  });

  it('returns to conversation files when the editor was opened from that route', () => {
    mockRouteParams = {
      source: 'local',
      conversationId: 'conv-1',
      filePath: 'src/App.tsx',
      content: 'console.log(1);',
      returnToConversationFiles: {
        conversationId: 'conv-1',
        initialDirectoryPath: 'src',
      },
    };

    render(<CodeEditorScreen />);

    expect(mockUseBackToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeNavigate: expect.any(Function),
        targetRoute: {
          name: 'ConversationFiles',
          params: {
            conversationId: 'conv-1',
            initialFilePath: undefined,
            initialDirectoryPath: 'src',
          },
        },
      }),
    );
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

    const { getByText, getByDisplayValue, getByLabelText } = render(<CodeEditorScreen />);

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

    mockEditorContent = 'console.log(2);';
    fireEvent.press(getByText('mark-dirty'));
    fireEvent.press(getByLabelText('codeEditor.saveFile'));

    await waitFor(() => {
      expect(mockWriteWorkspaceFile).toHaveBeenCalledWith(
        mockSettings.workspaceTargets[0],
        '/workspace/project/src/App.tsx',
        'console.log(2);',
      );
    });

    expect(getByText('codemirror-load-failed')).toBeTruthy();
  });

  it('opens and saves a conversation workspace file through the editor workflow', async () => {
    mockRouteParams = {
      source: 'local',
      conversationId: 'conv-1',
      filePath: 'src/App.tsx',
      content: 'console.log(1);',
    };

    const { getAllByText, getByDisplayValue, getByLabelText, getByText } = render(
      <CodeEditorScreen />,
    );

    expect(getByDisplayValue('src/App.tsx')).toBeTruthy();
    expect(getAllByText('common.files').length).toBeGreaterThan(0);

    mockEditorContent = 'console.log(2);';
    fireEvent.press(getByText('mark-dirty'));
    fireEvent.press(getByLabelText('codeEditor.saveFile'));

    await waitFor(() => {
      expect(mockWriteConversationWorkspaceTextFile).toHaveBeenCalledWith(
        'conv-1',
        'src/App.tsx',
        'console.log(2);',
      );
    });

    fireEvent.press(getByText('codeEditor.reloadFile'));

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
    mockRouteParams = {
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

  it('toggles the editor read-only mode', async () => {
    mockSettings.workspaceTargets = [
      {
        id: 'ws-1',
        name: 'Workspace A',
        rootPath: '/workspace/project',
        provider: 'code-server',
        enabled: true,
      },
    ];

    const { getByLabelText } = render(<CodeEditorScreen />);

    fireEvent.press(getByLabelText('codeEditor.switchToReadOnly'));
    expect(mockSetEditorReadOnly).toHaveBeenCalledWith(true);

    fireEvent.press(getByLabelText('codeEditor.switchToEditable'));
    expect(mockSetEditorReadOnly).toHaveBeenCalledWith(false);
  });

  it('shows the no-target state when a remote source has no enabled targets', () => {
    mockRouteParams = { source: 'workspace' };

    const { getByText } = render(<CodeEditorScreen />);

    expect(getByText('codeEditor.noTargetTitle')).toBeTruthy();
    fireEvent.press(getByText('codeEditor.openRemoteWork'));
    expect(mockNavigate).toHaveBeenCalledWith('RemoteWork');
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

    mockEditorContent = 'console.log(2);';
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
      expect(alertSpy).toHaveBeenCalledWith('codeEditor.openFailedTitle', 'open boom');
    });
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

    mockEditorContent = 'console.log(3);';
    fireEvent.press(getByText('mark-dirty'));
    fireEvent.press(getByLabelText('codeEditor.saveFile'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('codeEditor.saveFailedTitle', 'save boom');
    });
    alertSpy.mockRestore();
  });
});
