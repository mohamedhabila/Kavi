import { fireEvent, render } from '@testing-library/react-native';
import { ChatsScreen } from '../../src/screens/ChatsScreen';

const mockNavigate = jest.fn();
const mockOpenDrawer = jest.fn();
const mockSetActiveConversation = jest.fn();
let mockActiveConversationId: string | null = 'conv-active';
let mockConversations: any[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    openDrawer: mockOpenDrawer,
  }),
}));

jest.mock('@react-navigation/drawer', () => ({
  DrawerNavigationProp: {},
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: (selector: (state: any) => unknown) =>
    selector({
      conversations: mockConversations,
      activeConversationId: mockActiveConversationId,
      setActiveConversation: mockSetActiveConversation,
    }),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      header: '#111',
      border: '#333',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      primary: '#0f0',
      primarySoft: '#030',
      onPrimary: '#fff',
    },
  }),
  AppPalette: {},
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

describe('ChatsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveConversationId = 'conv-active';
    mockConversations = [
      {
        id: 'conv-older',
        title: 'Plan a holiday',
        messages: [],
        providerId: 'openrouter',
        systemPrompt: '',
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: 'conv-active',
        title: 'Weekly groceries and a deliberately long conversation title',
        messages: [],
        providerId: 'openrouter',
        systemPrompt: '',
        createdAt: 20,
        updatedAt: 20,
      },
      {
        id: 'conv-archived',
        title: 'Migration archive',
        messages: [],
        providerId: 'openrouter',
        systemPrompt: '',
        createdAt: 30,
        updatedAt: 30,
        archivedFromMigration: true,
      },
    ];
  });

  it('renders navigable chats, preserves long titles, and marks the active chat', () => {
    const { getByTestId, getByText, queryByText } = render(<ChatsScreen />);

    expect(getByText('Weekly groceries and a deliberately long conversation title')).toBeTruthy();
    expect(getByText('Plan a holiday')).toBeTruthy();
    expect(queryByText('Migration archive')).toBeNull();
    expect(getByTestId('chats-conversation-conv-active').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('opens the exact selected conversation', () => {
    const { getByTestId } = render(<ChatsScreen />);

    fireEvent.press(getByTestId('chats-conversation-conv-older'));

    expect(mockSetActiveConversation).toHaveBeenCalledWith('conv-older');
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('filters chats by title and presents a recoverable no-results state', () => {
    const { getByTestId, getByText, queryByText } = render(<ChatsScreen />);

    fireEvent.changeText(getByTestId('chats-search'), 'holiday');
    expect(getByText('Plan a holiday')).toBeTruthy();
    expect(queryByText('Weekly groceries and a deliberately long conversation title')).toBeNull();

    fireEvent.changeText(getByTestId('chats-search'), 'not present');
    expect(getByText('No matching chats')).toBeTruthy();
    const clearSearch = getByTestId('chats-clear-search');
    expect(clearSearch.props.accessibilityLabel).toBe('Clear search');
    fireEvent.press(clearSearch);
    expect(getByText('Plan a holiday')).toBeTruthy();
  });

  it('guides an empty history back to the Assistant', () => {
    mockConversations = [];
    const { getByTestId, getByText } = render(<ChatsScreen />);

    expect(getByText('No chats yet')).toBeTruthy();
    const openAssistant = getByTestId('chats-open-assistant');
    expect(openAssistant.props.accessibilityLabel).toBe('Assistant');
    fireEvent.press(openAssistant);
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('keeps the drawer reachable from the top-level Chats route', () => {
    const { getByTestId } = render(<ChatsScreen />);

    fireEvent.press(getByTestId('chats-open-menu'));

    expect(mockOpenDrawer).toHaveBeenCalledTimes(1);
  });
});
