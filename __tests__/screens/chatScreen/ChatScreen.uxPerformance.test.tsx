import { StyleSheet } from 'react-native';
import {
  fireEvent,
  FlatList,
  render,
  ChatScreen,
  memoizedChatInputType,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState } from '../../../testSupport/chatScreen/state';
import { mockNavigate } from '../../../testSupport/chatScreen/componentMocks';
import { mockSetActiveConversation } from '../../../testSupport/chatScreen/storeMocks';

describe('ChatScreen UX performance contracts', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('uses mobile-sized touch targets for header icon actions', () => {
    const { getByLabelText } = render(<ChatScreen />);

    const menuButtonStyle = StyleSheet.flatten(getByLabelText('Open menu').props.style);
    const filesButtonStyle = StyleSheet.flatten(getByLabelText('Files').props.style);
    const terminalButtonStyle = StyleSheet.flatten(getByLabelText('Terminal').props.style);
    const sideThreadButtonStyle = StyleSheet.flatten(
      getByLabelText('Start a side thread').props.style,
    );

    expect(menuButtonStyle).toEqual(expect.objectContaining({ width: 44, height: 44 }));
    expect(filesButtonStyle).toEqual(expect.objectContaining({ width: 44, height: 44 }));
    expect(terminalButtonStyle).toEqual(expect.objectContaining({ width: 44, height: 44 }));
    expect(sideThreadButtonStyle).toEqual(expect.objectContaining({ width: 44, height: 44 }));
  });

  it('keeps the message list render function stable while the composer changes', () => {
    const { UNSAFE_getByType, getByPlaceholderText } = render(<ChatScreen />);
    const beforeRenderItem = UNSAFE_getByType(FlatList).props.renderItem;
    const beforeCancelEdit = UNSAFE_getByType(memoizedChatInputType).props.onCancelEdit;

    fireEvent.changeText(getByPlaceholderText('Message...'), 'Draft without list churn');

    expect(UNSAFE_getByType(FlatList).props.renderItem).toBe(beforeRenderItem);
    expect(UNSAFE_getByType(memoizedChatInputType).props.onCancelEdit).toBe(beforeCancelEdit);
  });

  it('offers outcome-based starters that prepare the composer without sending', () => {
    mockChatScreenState.conversations = [
      {
        ...mockChatScreenState.conversations[0],
        messages: [],
      },
    ];

    const { getByPlaceholderText, getByText } = render(<ChatScreen />);

    expect(getByText('Ask & understand')).toBeTruthy();
    expect(getByText('Research current information')).toBeTruthy();
    expect(getByText('Plan & remind')).toBeTruthy();

    fireEvent.press(getByText('Ask & understand'));

    expect(getByPlaceholderText('Message...').props.value).toBe(
      'Explain a topic to me in simple terms.',
    );
  });

  it('shows provider recovery only when setup is missing', () => {
    mockChatScreenState.providersList = [];
    mockChatScreenState.conversations = [
      {
        ...mockChatScreenState.conversations[0],
        messages: [],
      },
    ];

    const { getByText, queryByText } = render(<ChatScreen />);

    expect(getByText('Connect an AI provider')).toBeTruthy();
    expect(getByText('Set up AI provider')).toBeTruthy();
    expect(queryByText('Ask & understand')).toBeNull();

    fireEvent.press(getByText('Set up AI provider'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });

  it('resumes the most recent non-empty conversation from the start state', () => {
    mockChatScreenState.conversations = [
      {
        ...mockChatScreenState.conversations[0],
        id: 'empty-conversation',
        title: 'New Conversation',
        messages: [],
        updatedAt: 20,
      },
      {
        ...mockChatScreenState.conversations[0],
        id: 'recent-conversation',
        title: 'Weekend trip ideas',
        updatedAt: 10,
      },
    ];
    mockChatScreenState.activeConversationId = 'empty-conversation';

    const { getByTestId, getByText } = render(<ChatScreen />);

    expect(getByText('Weekend trip ideas')).toBeTruthy();
    fireEvent.press(getByTestId('assistant-start-recent'));

    expect(mockSetActiveConversation).toHaveBeenCalledWith('recent-conversation');
  });
});
