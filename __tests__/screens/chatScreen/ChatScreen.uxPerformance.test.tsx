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
});
