import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MessageBubble } from '../../src/components/chat/MessageBubble';
import type { Message } from '../../src/types/message';

jest.mock('../../src/components/chat/MessageContentRenderer', () => ({
  MessageContentRenderer: ({ content }: { content: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, null, content);
  },
}));

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'chat.copyMessage': 'Copy message',
        'chat.editMessage': 'Edit message',
        'chat.retryMessage': 'Retry message',
        'chat.shareMessage': 'Share message',
        'settings.personaDisplayNamePlaceholder': 'Assistant',
      })[key] || key,
  }),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      dangerSoft: '#300',
      info: '#09f',
      link: '#0af',
      userBubble: '#060',
      assistantBubble: '#111',
      accent: '#0f0',
    },
  }),
}));

jest.mock('../../src/services/share/localShare', () => ({
  shareTextExport: jest.fn(),
}));

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'msg-1',
  role: 'user',
  content: 'Hello world',
  timestamp: 1_700_000_000_000,
  ...overrides,
});

const expectMobileActionTarget = (node: { props: { style: unknown } }) => {
  expect(StyleSheet.flatten(node.props.style)).toEqual(
    expect.objectContaining({ minWidth: 44, minHeight: 44 }),
  );
};

describe('MessageBubble actions', () => {
  it('uses mobile-sized touch targets for user message actions', () => {
    const { getByLabelText } = render(
      <MessageBubble message={makeMessage()} onEdit={jest.fn()} />,
    );

    expectMobileActionTarget(getByLabelText('Copy message'));
    expectMobileActionTarget(getByLabelText('Edit message'));
  });

  it('uses mobile-sized touch targets for assistant message actions', () => {
    const message = makeMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Here is the answer.',
    });
    const { getByLabelText } = render(<MessageBubble message={message} onRetry={jest.fn()} />);

    expectMobileActionTarget(getByLabelText('Copy message'));
    expectMobileActionTarget(getByLabelText('Share message'));
    expectMobileActionTarget(getByLabelText('Retry message'));
  });

  it('marks assistant copy unavailable when there is no copyable content', () => {
    const message = makeMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
    });
    const { getByLabelText, queryByLabelText } = render(<MessageBubble message={message} />);

    expect(getByLabelText('Copy message').props.accessibilityState).toEqual({ disabled: true });
    expect(queryByLabelText('Share message')).toBeNull();
  });

  it('marks user copy unavailable when there is no copyable text', () => {
    const { getByLabelText } = render(<MessageBubble message={makeMessage({ content: '' })} />);

    expect(getByLabelText('Copy message').props.accessibilityState).toEqual({ disabled: true });
  });
});
