import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { createStyles } from '../../../src/screens/ChatScreen.styles';
import { ChatScreenHeader } from '../../../src/screens/chatScreen/ChatScreenHeader';
import type { Conversation } from '../../../src/types/conversation';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => <>{children}</>,
}));

const colors = {
  background: '#000000',
  border: '#333333',
  danger: '#ff3333',
  header: '#111111',
  onPrimary: '#ffffff',
  overlay: 'rgba(0,0,0,0.5)',
  primary: '#3388ff',
  primarySoft: '#112244',
  success: '#22aa66',
  surface: '#181818',
  surfaceAlt: '#242424',
  text: '#ffffff',
  textSecondary: '#bbbbbb',
  textTertiary: '#888888',
} as any;

const translations: Record<string, string> = {
  'chat.conversationOptions': 'Conversation options',
  'chat.conversationSettings': 'Conversation settings',
  'chat.discardSideThread': 'Discard side thread',
  'chat.headerStatusReady': 'Ready',
  'chat.headerStatusWorking': 'Working…',
  'chat.openConversationOptions': 'Open conversation options',
  'chat.openMenu': 'Open menu',
  'chat.startSideThread': 'Start a side thread',
  'chat.usageActivity': 'Usage & activity',
  'common.close': 'Close',
  'nav.developerAndRemoteWork': 'Developer & remote work',
  'nav.filesAndCreations': 'Files & creations',
  'nav.newChat': 'New chat',
};

const t = (key: string) => translations[key] ?? key;
const styles = createStyles(colors);
const conversation = {
  id: 'conversation-1',
  title: 'Plan a family trip with an unusually long title',
  messages: [],
  providerId: 'provider-1',
  systemPrompt: '',
  createdAt: 1,
  updatedAt: 1,
} as Conversation;

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    activeConversation: conversation,
    colors,
    isConversationBusy: false,
    onOpenConversationSettings: jest.fn(),
    onOpenDeveloperTools: jest.fn(),
    onOpenFiles: jest.fn(),
    onOpenMenu: jest.fn(),
    onOpenUsage: jest.fn(),
    onToggleSideThread: jest.fn(),
    styles,
    t,
    ...overrides,
  };
}

describe('ChatScreenHeader', () => {
  it('keeps the primary header compact and reports truthful idle status', () => {
    const props = createProps();
    const { getByText, getByTestId, queryByTestId, queryByText } = render(
      <ChatScreenHeader {...props} />,
    );

    expect(getByTestId('chat-compact-header')).toBeTruthy();
    expect(getByText(conversation.title)).toBeTruthy();
    expect(getByText('Ready')).toBeTruthy();
    expect(queryByTestId('model-selector-trigger')).toBeNull();
    expect(queryByText('Agent')).toBeNull();
    expect(queryByText('Chitchat')).toBeNull();

    fireEvent.press(getByTestId('chat-open-menu'));
    expect(props.onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('uses the verified busy state for the header status', () => {
    const { getByText } = render(
      <ChatScreenHeader {...createProps({ isConversationBusy: true })} />,
    );

    expect(getByText('Working…')).toBeTruthy();
  });

  it('groups conversation and advanced actions behind one overflow control', () => {
    const props = createProps();
    const { getByTestId, getByText, queryByText } = render(<ChatScreenHeader {...props} />);

    expect(queryByText('Conversation settings')).toBeNull();
    fireEvent.press(getByTestId('chat-open-conversation-options'));

    expect(getByText('Conversation options')).toBeTruthy();
    expect(getByText('Conversation settings')).toBeTruthy();
    expect(getByText('Files & creations')).toBeTruthy();
    expect(getByText('Usage & activity')).toBeTruthy();
    expect(getByText('Start a side thread')).toBeTruthy();
    expect(getByText('Developer & remote work')).toBeTruthy();

    fireEvent.press(getByTestId('chat-open-conversation-settings'));
    expect(props.onOpenConversationSettings).toHaveBeenCalledTimes(1);
    expect(queryByText('Conversation options')).toBeNull();
  });

  it('uses the safe discard action for a side conversation', () => {
    const props = createProps({
      activeConversation: { ...conversation, isSideThread: true },
    });
    const { getByTestId, getByText } = render(<ChatScreenHeader {...props} />);

    fireEvent.press(getByTestId('chat-open-conversation-options'));
    expect(getByText('Discard side thread')).toBeTruthy();
    fireEvent.press(getByTestId('chat-discard-side-thread'));

    expect(props.onToggleSideThread).toHaveBeenCalledTimes(1);
  });
});
