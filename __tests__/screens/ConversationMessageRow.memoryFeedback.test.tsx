import React from 'react';
import { render } from '@testing-library/react-native';
import { ConversationMessageRow } from '../../src/screens/chatScreen/ConversationMessageRow';
import type { ResolvedDisplayMessageItem } from '../../src/screens/chatScreenDisplayState';
import type { Message } from '../../src/types/message';

const mockMessageBubble = jest.fn(() => null);

jest.mock('../../src/components/chat/MessageBubble', () => ({
  MessageBubble: (props: unknown) => mockMessageBubble(props),
}));

const EVENT_ID = 'retrieval_event_m123_1_abc';

function makeMessage(id: string, eventId?: string): Message {
  return {
    id,
    role: 'assistant',
    content: 'Answer',
    timestamp: 1,
    ...(eventId
      ? {
          assistantMetadata: {
            kind: 'final' as const,
            completionStatus: 'complete' as const,
            finishReason: 'stop',
            memoryRetrievalEventId: eventId,
          },
        }
      : {}),
  };
}

function makeItem(segmentEventId = EVENT_ID): ResolvedDisplayMessageItem {
  const resolvedMessage = makeMessage('assistant-group-projection', EVENT_ID);
  return {
    id: resolvedMessage.id,
    message: resolvedMessage,
    sourceMessageIds: ['assistant-intermediate', 'assistant-exact-final'],
    resolvedMessage,
    resolvedResponseSegments: [
      {
        id: 'segment-intermediate',
        messageId: 'assistant-intermediate',
        content: 'Working',
        timestamp: 1,
        isStreaming: false,
      },
      {
        id: 'segment-final',
        messageId: 'assistant-exact-final',
        content: 'Answer',
        timestamp: 2,
        assistantMetadata: makeMessage('unused', segmentEventId).assistantMetadata,
        isStreaming: false,
      },
    ],
    isStreaming: false,
  };
}

function renderRow(item: ResolvedDisplayMessageItem) {
  return render(
    <ConversationMessageRow
      item={item}
      onEdit={jest.fn()}
      onLoadMemoryFeedback={jest.fn()}
      onMemoryFeedback={jest.fn()}
      onOpenSubAgentDetails={jest.fn()}
      onRetry={jest.fn()}
      onShareWorkspaceFile={jest.fn()}
      onViewFiles={jest.fn()}
      styles={{} as any}
    />,
  );
}

describe('ConversationMessageRow memory feedback identity', () => {
  beforeEach(() => {
    mockMessageBubble.mockClear();
  });

  it('routes a grouped response to the exact attributed persisted segment', () => {
    renderRow(makeItem());

    expect(mockMessageBubble).toHaveBeenCalledWith(
      expect.objectContaining({ memoryFeedbackMessageId: 'assistant-exact-final' }),
    );
  });

  it('fails closed when no persisted segment carries the projected event', () => {
    renderRow(makeItem('retrieval_event_other_1_abc'));

    expect(mockMessageBubble).toHaveBeenCalledWith(
      expect.objectContaining({ memoryFeedbackMessageId: null }),
    );
  });
});
