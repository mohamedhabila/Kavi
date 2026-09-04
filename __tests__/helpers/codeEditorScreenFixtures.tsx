// ---------------------------------------------------------------------------
// Shared fixtures for the CodeEditorScreen test suites. Extracted when the
// original single file crossed the repository's 700-line maintainability
// limit. Both sibling suites (CodeEditorScreen.test.tsx for navigation/UI
// state, CodeEditorScreen.filePersistence.test.tsx for open/save workflows
// and their error handling) import this module before importing the screen
// itself so every jest.mock registration below is active by the time the
// screen's own dependency graph is required.
// ---------------------------------------------------------------------------

export const mockNavigate = jest.fn();
export const mockHandleBack = jest.fn();
export const mockUseBackToChat = jest.fn(() => mockHandleBack);
export const mockTranslate = (key: string) => (key === 'common.back' ? 'Back' : key);

export const mockSettings = {
  sshTargets: [] as any[],
  workspaceTargets: [] as any[],
  developerModeEnabled: false,
};

export const mockReadWorkspaceFile = jest.fn();
export const mockWriteWorkspaceFile = jest.fn();
export const mockListWorkspaceDirectory = jest
  .fn()
  .mockResolvedValue({ path: '/workspace/project', entries: [] });
export const mockReadConversationWorkspaceTextFile = jest.fn();
export const mockWriteConversationWorkspaceTextFile = jest.fn();
export const mockReadSshTextFile = jest.fn();
export const mockWriteSshTextFile = jest.fn();
export const mockListSshDirectory = jest.fn().mockResolvedValue([]);

export const mockSetEditorReadOnly = jest.fn();

/**
 * Mutable state read by the mocked navigation/editor modules below. Kept on a
 * single object (rather than reassigned `let` bindings) so both sibling test
 * files can import and mutate it directly — an imported `let` binding cannot
 * be reassigned from a consumer module.
 */
export const mockCodeEditorScreenState = {
  routeParams: {} as any,
  editorContent: '',
  browserSelectedPath: null as string | null,
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
  useRoute: () => ({ params: mockCodeEditorScreenState.routeParams }),
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

jest.mock('../../src/i18n/useTranslation', () => ({
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
  useSettingsStore: Object.assign((selector: any) => selector(mockSettings), {
    getState: () => mockSettings,
  }),
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
              mockCodeEditorScreenState.browserSelectedPath ??
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
        getContent: () =>
          props.onContent?.(mockCodeEditorScreenState.editorContent || props.initialContent || ''),
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
          onPress={() =>
            props.onContent?.(mockCodeEditorScreenState.editorContent || props.initialContent || '')
          }
        >
          <Text>emit-editor-content</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => props.onModeChange?.('fallback', 'codemirror-load-failed')}
        >
          <Text>set-fallback-mode</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => props.onModeChange?.('codemirror')}>
          <Text>set-codemirror-mode</Text>
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

/** Mirrors the shared `beforeEach` body every CodeEditorScreen suite used to run inline. */
export function resetCodeEditorScreenFixtures() {
  jest.clearAllMocks();
  mockCodeEditorScreenState.routeParams = {};
  mockSettings.sshTargets = [];
  mockSettings.workspaceTargets = [];
  mockSettings.developerModeEnabled = false;
  mockCodeEditorScreenState.editorContent = '';
  mockCodeEditorScreenState.browserSelectedPath = null;
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
}
