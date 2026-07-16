import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
        'chat.memoryFeedbackPrompt': 'Did the remembered context help?',
        'chat.memoryFeedbackHelpful': 'Helpful',
        'chat.memoryFeedbackWrong': 'Wrong',
        'chat.memoryFeedbackIrrelevant': 'Not relevant',
        'chat.memoryFeedbackFailed': 'Unable to save memory feedback right now.',
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
    const { getByLabelText } = render(<MessageBubble message={makeMessage()} onEdit={jest.fn()} />);

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

  it('shows explicit memory choices only for a complete attributed final response', () => {
    const onMemoryFeedback = jest.fn().mockResolvedValue('helpful');
    const baseMessage = makeMessage({
      id: 'assistant-memory',
      role: 'assistant',
      content: 'Remembered answer.',
    });
    const { queryByLabelText, rerender } = render(
      <MessageBubble message={baseMessage} onMemoryFeedback={onMemoryFeedback} />,
    );
    expect(queryByLabelText('Helpful')).toBeNull();

    rerender(
      <MessageBubble
        message={{
          ...baseMessage,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
            memoryRetrievalEventId: '../not-code-owned',
          },
        }}
        onMemoryFeedback={onMemoryFeedback}
      />,
    );
    expect(queryByLabelText('Helpful')).toBeNull();

    rerender(
      <MessageBubble
        message={{
          ...baseMessage,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'response_failed',
            memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
          },
        }}
        onMemoryFeedback={onMemoryFeedback}
      />,
    );
    expect(queryByLabelText('Helpful')).toBeNull();

    rerender(
      <MessageBubble
        message={{
          ...baseMessage,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
            memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
          },
        }}
        memoryFeedbackMessageId={null}
        onMemoryFeedback={onMemoryFeedback}
      />,
    );
    expect(queryByLabelText('Helpful')).toBeNull();
  });

  it('loads and records feedback against the exact persisted assistant message', async () => {
    const onLoadMemoryFeedback = jest.fn().mockResolvedValue('helpful');
    const onMemoryFeedback = jest.fn().mockResolvedValue('wrong');
    const message = makeMessage({
      id: 'assistant-group-projection',
      role: 'assistant',
      content: 'Remembered answer.',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
      },
    });
    const { getByLabelText } = render(
      <MessageBubble
        message={message}
        memoryFeedbackMessageId="assistant-persisted-final"
        onLoadMemoryFeedback={onLoadMemoryFeedback}
        onMemoryFeedback={onMemoryFeedback}
      />,
    );

    await waitFor(() => {
      expect(onLoadMemoryFeedback).toHaveBeenCalledWith(
        'assistant-persisted-final',
        'retrieval_event_m123_1_abc',
      );
      expect(getByLabelText('Helpful').props.accessibilityState).toEqual({
        disabled: false,
        selected: true,
      });
    });

    fireEvent.press(getByLabelText('Wrong'));
    await waitFor(() => {
      expect(onMemoryFeedback).toHaveBeenCalledWith(
        'assistant-persisted-final',
        'retrieval_event_m123_1_abc',
        'wrong',
      );
      expect(getByLabelText('Wrong').props.accessibilityState).toEqual({
        disabled: false,
        selected: true,
      });
    });
    expectMobileActionTarget(getByLabelText('Wrong'));
  });

  it('keeps a failed feedback write explicit and retryable', async () => {
    const onMemoryFeedback = jest.fn().mockRejectedValue(new Error('storage unavailable'));
    const message = makeMessage({
      id: 'assistant-memory',
      role: 'assistant',
      content: 'Remembered answer.',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
      },
    });
    const { getByLabelText, getByText } = render(
      <MessageBubble message={message} onMemoryFeedback={onMemoryFeedback} />,
    );

    fireEvent.press(getByLabelText('Not relevant'));

    await waitFor(() => {
      expect(getByText('Unable to save memory feedback right now.')).toBeTruthy();
      expect(getByLabelText('Not relevant').props.accessibilityState).toEqual({
        disabled: false,
        selected: false,
      });
    });
  });

  it('does not let a stale feedback read overwrite a newer explicit choice', async () => {
    let resolveLoad: (outcome: 'helpful') => void = () => undefined;
    const onLoadMemoryFeedback = jest.fn(
      () =>
        new Promise<'helpful'>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const onMemoryFeedback = jest.fn().mockResolvedValue('wrong');
    const message = makeMessage({
      id: 'assistant-memory',
      role: 'assistant',
      content: 'Remembered answer.',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
      },
    });
    const { getByLabelText } = render(
      <MessageBubble
        message={message}
        onLoadMemoryFeedback={onLoadMemoryFeedback}
        onMemoryFeedback={onMemoryFeedback}
      />,
    );

    fireEvent.press(getByLabelText('Wrong'));
    await waitFor(() => {
      expect(getByLabelText('Wrong').props.accessibilityState.selected).toBe(true);
    });
    await act(async () => {
      resolveLoad('helpful');
      await Promise.resolve();
    });

    expect(getByLabelText('Wrong').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Helpful').props.accessibilityState.selected).toBe(false);
  });
});
