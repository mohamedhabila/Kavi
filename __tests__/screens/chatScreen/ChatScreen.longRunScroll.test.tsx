import { StyleSheet } from 'react-native';
import {
  act,
  fireEvent,
  FlatList,
  render,
  waitFor,
  ChatScreen,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { createDefaultConversations } from '../../../testSupport/chatScreen/fixtures';
import { mockChatScreenState } from '../../../testSupport/chatScreen/state';

const moveListAwayFromBottom = (messageList: any) => {
  act(() => {
    messageList.props.onScroll?.({
      nativeEvent: {
        contentOffset: { y: 120 },
        contentSize: { height: 1800 },
        layoutMeasurement: { height: 640 },
      },
    });
  });
};

describe('ChatScreen long-run scroll UX', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(() => {
    jest.restoreAllMocks();
    cleanupChatScreenTestEnvironment();
  });

  it('surfaces new latest activity without overriding manual reading position', async () => {
    const scrollToEndSpy = jest
      .spyOn((FlatList as any).prototype, 'scrollToEnd')
      .mockImplementation(() => {});
    const screen = render(<ChatScreen />);
    const messageList = screen.UNSAFE_getByType(FlatList);

    moveListAwayFromBottom(messageList);
    scrollToEndSpy.mockClear();

    const conversation = createDefaultConversations()[0];
    mockChatScreenState.conversations = [
      {
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: 'msg-new-latest',
            role: 'assistant',
            content: 'A newer answer arrived.',
            timestamp: 1_700_000_000_100,
          },
        ],
      },
    ];
    screen.rerender(<ChatScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-jump-to-latest')).toBeTruthy();
    });

    const jumpButton = screen.getByTestId('chat-jump-to-latest');
    expect(StyleSheet.flatten(jumpButton.props.style)).toEqual(
      expect.objectContaining({ minHeight: 44 }),
    );
    expect(scrollToEndSpy).not.toHaveBeenCalled();

    fireEvent.press(jumpButton);

    await waitFor(() => {
      expect(scrollToEndSpy).toHaveBeenCalledWith({ animated: true });
    });
    expect(screen.queryByTestId('chat-jump-to-latest')).toBeNull();
  });
});
