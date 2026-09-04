import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  mockCodeEditorScreenState,
  mockHandleBack,
  mockNavigate,
  mockSetEditorReadOnly,
  mockSettings,
  mockUseBackToChat,
  resetCodeEditorScreenFixtures,
} from '../helpers/codeEditorScreenFixtures';
import { CodeEditorScreen } from '../../src/screens/CodeEditorScreen';

describe('CodeEditorScreen', () => {
  beforeEach(() => {
    resetCodeEditorScreenFixtures();
  });

  it('guides the user before opening a temporary standalone scratch', () => {
    const { getByLabelText, getByTestId, getByText, queryByLabelText, queryByTestId, queryByText } =
      render(<CodeEditorScreen />);

    expect(getByTestId('code-editor-setup-guide')).toBeTruthy();
    expect(getByText('codeEditor.startEditingTitle')).toBeTruthy();
    expect(queryByTestId('mock-code-editor')).toBeNull();
    expect(getByTestId('code-editor-source-local').props.accessibilityState).toEqual({
      disabled: false,
      selected: true,
    });
    expect(getByTestId('code-editor-source-workspace').props.accessibilityState).toEqual({
      disabled: true,
      selected: false,
    });
    expect(getByLabelText('codeEditor.startScratch')).toBeTruthy();
    expect(getByLabelText('codeEditor.openRemoteWork')).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId('code-editor-start-scratch').props.style).minHeight).toBe(
      48,
    );

    fireEvent.press(getByTestId('code-editor-start-scratch'));

    expect(getByTestId('mock-code-editor')).toBeTruthy();
    expect(getByTestId('code-editor-scratch-notice')).toBeTruthy();
    expect(getByText('codeEditor.scratchModeMessage')).toBeTruthy();
    expect(getByLabelText('codeEditor.filePathLabel').props.editable).toBe(false);
    expect(getByTestId('code-editor-new-file').props.accessibilityLabel).toBe('codeEditor.newFile');
    expect(StyleSheet.flatten(getByTestId('code-editor-new-file').props.style).minHeight).toBe(48);
    expect(queryByLabelText('codeEditor.saveFile')).toBeNull();

    fireEvent.press(getByText('set-codemirror-mode'));
    expect(queryByText('codeEditor.fullEditorModeMessage')).toBeNull();
  });

  it('offers connected saved files as the alternate standalone path', () => {
    const { getByLabelText } = render(<CodeEditorScreen />);

    fireEvent.press(getByLabelText('codeEditor.openRemoteWork'));
    expect(mockNavigate).toHaveBeenCalledWith('RemoteWork');
  });

  it('uses full touch targets for the header and source controls', () => {
    const { getByLabelText, getByTestId } = render(<CodeEditorScreen />);

    expect(StyleSheet.flatten(getByLabelText('Back').props.style)).toMatchObject({
      minHeight: 48,
      width: 48,
    });
    expect(StyleSheet.flatten(getByTestId('code-editor-source-local').props.style).minHeight).toBe(
      48,
    );
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
    mockCodeEditorScreenState.routeParams = {
      source: 'local',
      conversationId: 'conv-1',
      filePath: 'src/App.tsx',
      content: 'console.log(1);',
      returnToConversationFiles: {
        conversationId: 'conv-1',
        initialDirectoryPath: '../src',
        initialScrollOffset: 380,
        initialSearchQuery: 'App',
        initialFileFilter: 'code',
        initialFileSort: 'name',
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
            initialScrollOffset: 380,
            initialSearchQuery: 'App',
            initialFileFilter: 'code',
            initialFileSort: 'name',
          },
        },
      }),
    );
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
    mockCodeEditorScreenState.routeParams = { source: 'workspace' };

    const { getByLabelText, getByText } = render(<CodeEditorScreen />);

    expect(getByText('codeEditor.noTargetTitle')).toBeTruthy();
    fireEvent.press(getByLabelText('codeEditor.openRemoteWork'));
    expect(mockNavigate).toHaveBeenCalledWith('RemoteWork');
  });
});
