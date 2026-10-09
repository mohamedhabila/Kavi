import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Modal, Platform } from 'react-native';
import { ChatsScreen } from '../../src/screens/ChatsScreen';

const mockRenameConversation = jest.fn();
const mockDeleteConversationStoppingWork = jest.fn();
const mockHasConversationWork = jest.fn();
let mockConversations: any[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), openDrawer: jest.fn() }),
}));

jest.mock('@react-navigation/drawer', () => ({ DrawerNavigationProp: {} }));

jest.mock('../../src/store/useChatStore', () => {
  const state = () => ({
    conversations: mockConversations,
    activeConversationId: null,
    setActiveConversation: jest.fn(),
    renameConversation: (...args: unknown[]) => mockRenameConversation(...args),
  });
  return {
    useChatStore: Object.assign((selector: (value: any) => unknown) => selector(state()), {
      getState: state,
    }),
  };
});

jest.mock('../../src/services/conversationDeletion', () => ({
  deleteConversationStoppingWork: (...args: unknown[]) =>
    mockDeleteConversationStoppingWork(...args),
}));

jest.mock('../../src/services/conversationWorkStop', () => ({
  hasConversationWork: (...args: unknown[]) => mockHasConversationWork(...args),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#181818',
      header: '#111',
      border: '#333',
      overlay: '#0008',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      primary: '#0f0',
      primarySoft: '#030',
      onPrimary: '#fff',
      danger: '#f33',
      dangerSoft: '#300',
      inputBackground: '#222',
    },
  }),
  AppPalette: {},
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

function conversation(id: string, title: string) {
  return {
    id,
    title,
    messages: [],
    providerId: 'openrouter',
    systemPrompt: '',
    createdAt: 10,
    updatedAt: 10,
  };
}

/** Choose an action, then finish the sheet's close the way iOS reports it. */
function chooseFromSheet(screen: ReturnType<typeof render>, action: 'rename' | 'delete') {
  fireEvent.press(screen.getByTestId(`conversation-action-${action}`));
  const sheet = screen.UNSAFE_getAllByType(Modal).find((modal) => modal.props.onDismiss);
  act(() => {
    sheet?.props.onDismiss?.();
  });
}

describe('ChatsScreen conversation actions', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConversations = [conversation('conv-1', 'Plan a holiday')];
    mockHasConversationWork.mockReturnValue(false);
    mockDeleteConversationStoppingWork.mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('renames a conversation from its options', () => {
    const screen = render(<ChatsScreen />);

    fireEvent.press(screen.getByTestId('chats-conversation-conv-1-actions'));
    chooseFromSheet(screen, 'rename');
    fireEvent.changeText(screen.getByTestId('conversation-rename-input'), 'Lisbon in May');
    fireEvent.press(screen.getByTestId('conversation-rename-save'));

    expect(mockRenameConversation).toHaveBeenCalledWith('conv-1', 'Lisbon in May');
  });

  it('opens the same options on a long press', () => {
    const screen = render(<ChatsScreen />);

    fireEvent(screen.getByTestId('chats-conversation-conv-1'), 'longPress');

    expect(screen.getByTestId('conversation-action-rename')).toBeTruthy();
  });

  it('does not save an empty name', () => {
    const screen = render(<ChatsScreen />);

    fireEvent.press(screen.getByTestId('chats-conversation-conv-1-actions'));
    chooseFromSheet(screen, 'rename');
    fireEvent.changeText(screen.getByTestId('conversation-rename-input'), '   ');
    fireEvent.press(screen.getByTestId('conversation-rename-save'));

    expect(mockRenameConversation).not.toHaveBeenCalled();
  });

  it('deletes only after the user confirms', async () => {
    const screen = render(<ChatsScreen />);

    fireEvent.press(screen.getByTestId('chats-conversation-conv-1-actions'));
    chooseFromSheet(screen, 'delete');

    expect(mockDeleteConversationStoppingWork).not.toHaveBeenCalled();
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Delete this chat?');
    expect(message).toContain('"Plan a holiday"');
    expect(message).not.toContain('still working');

    await act(async () => {
      buttons.find((button: { style?: string }) => button.style === 'destructive').onPress();
    });
    expect(mockDeleteConversationStoppingWork).toHaveBeenCalledWith('conv-1');
  });

  it('warns that deleting stops work still running in the chat', () => {
    mockHasConversationWork.mockReturnValue(true);
    const screen = render(<ChatsScreen />);

    fireEvent.press(screen.getByTestId('chats-conversation-conv-1-actions'));
    chooseFromSheet(screen, 'delete');

    expect(alertSpy.mock.calls[0][1]).toContain(
      'Kavi is still working in this chat. Deleting it stops that work.',
    );
  });

  it('shows progress on the row while deleting, and says when it failed', async () => {
    let rejectDelete: (error: Error) => void = () => undefined;
    mockDeleteConversationStoppingWork.mockImplementation(
      () => new Promise((_resolve, reject) => (rejectDelete = reject)),
    );
    const screen = render(<ChatsScreen />);

    fireEvent.press(screen.getByTestId('chats-conversation-conv-1-actions'));
    chooseFromSheet(screen, 'delete');
    act(() => {
      alertSpy.mock.calls[0][2]
        .find((button: { style?: string }) => button.style === 'destructive')
        .onPress();
    });

    expect(screen.getByTestId('chats-conversation-conv-1-busy')).toBeTruthy();
    expect(screen.queryByTestId('chats-conversation-conv-1-actions')).toBeNull();

    await act(async () => rejectDelete(new Error('journal_unavailable')));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenLastCalledWith(
        'Error',
        'This chat could not be deleted. Please try again.',
      ),
    );
    expect(screen.getByTestId('chats-conversation-conv-1-actions')).toBeTruthy();
  });

  it('runs the chosen action at once on Android, where a closing sheet does not block alerts', () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    try {
      const screen = render(<ChatsScreen />);

      fireEvent.press(screen.getByTestId('chats-conversation-conv-1-actions'));
      fireEvent.press(screen.getByTestId('conversation-action-delete'));

      expect(alertSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
    }
  });
});
