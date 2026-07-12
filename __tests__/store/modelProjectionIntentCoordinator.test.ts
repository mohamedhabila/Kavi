import { useChatStore } from '../helpers/chatStoreHarness';
import {
  beginModelProjectionIntent,
  hasModelProjectionIntent,
  resetModelProjectionIntentCoordinatorForTests,
  tryClaimScheduledModelProjection,
} from '../../src/store/modelProjectionIntentCoordinator';
import type { ModelProjectionOwner } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

function owner(requestMessageId = 'scheduled-request'): ModelProjectionOwner {
  return {
    surface: 'scheduler',
    runId: 'scheduled-run',
    requestMessageId,
    assistantMessageId: 'scheduled-assistant',
    controlEpoch: 0,
  };
}

function createConversation(messages: Message[] = []): string {
  const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
  for (const message of messages) {
    useChatStore.getState().addMessage(conversationId, message);
  }
  return conversationId;
}

function scheduledClaim(conversationId: string, projectionOwner = owner()) {
  return tryClaimScheduledModelProjection({
    conversationId,
    owner: projectionOwner,
    messagesBeforeAssistant: [
      {
        id: projectionOwner.requestMessageId,
        role: 'user',
        content: 'Run the scheduled task.',
        timestamp: 3,
      },
    ],
    assistantMessage: {
      id: projectionOwner.assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: 4,
    },
  });
}

beforeEach(() => {
  resetModelProjectionIntentCoordinatorForTests();
  useChatStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
});

describe('model projection intent coordinator', () => {
  it('retains foreground intent until every token lease releases', () => {
    const first = beginModelProjectionIntent('conversation-1', 'request-1');
    const second = beginModelProjectionIntent('conversation-1', 'request-1');
    const third = beginModelProjectionIntent('conversation-1', 'request-2');

    first.release();
    first.release();
    expect(hasModelProjectionIntent('conversation-1')).toBe(true);

    second.release();
    expect(hasModelProjectionIntent('conversation-1')).toBe(true);

    third.release();
    expect(hasModelProjectionIntent('conversation-1')).toBe(false);
  });

  it('rejects a scheduled claim without appending its prelude while foreground intent exists', () => {
    const conversationId = createConversation();
    const intent = beginModelProjectionIntent(conversationId, 'foreground-request');

    expect(scheduledClaim(conversationId)).toBe('model_projection_intent');
    expect(
      useChatStore.getState().conversations.find((item) => item.id === conversationId)?.messages,
    ).toEqual([]);

    intent.release();
  });

  it.each([
    ['content without terminal metadata', undefined],
    [
      'terminal review pending',
      {
        kind: 'final' as const,
        completionStatus: 'incomplete' as const,
        finishReason: 'terminal_review_pending',
      },
    ],
    [
      'surfaced worker output pending',
      {
        kind: 'final' as const,
        completionStatus: 'incomplete' as const,
        finishReason: 'surfaced_worker_output_pending',
      },
    ],
    [
      'yielded worker checkpoint',
      {
        kind: 'final' as const,
        completionStatus: 'complete' as const,
        finishReason: 'yielded',
      },
    ],
  ])('treats a foreign %s tail as unsettled', (_label, assistantMetadata) => {
    const conversationId = createConversation([
      { id: 'foreign-request', role: 'user', content: 'First task.', timestamp: 1 },
      {
        id: 'foreign-assistant',
        role: 'assistant',
        content: 'Still working.',
        timestamp: 2,
        assistantMetadata,
      },
    ]);

    expect(scheduledClaim(conversationId)).toBe('unsettled_conversation_tail');
    expect(
      useChatStore
        .getState()
        .conversations.find((item) => item.id === conversationId)
        ?.messages.some((message) => message.id === 'scheduled-request'),
    ).toBe(false);
  });

  it.each([
    {
      kind: 'final' as const,
      completionStatus: 'complete' as const,
      finishReason: 'stop',
    },
    {
      kind: 'final' as const,
      completionStatus: 'incomplete' as const,
      finishReason: 'response_failed',
    },
  ])('allows a scheduled claim after an explicitly settled foreign tail', (assistantMetadata) => {
    const conversationId = createConversation([
      { id: 'foreign-request', role: 'user', content: 'First task.', timestamp: 1 },
      {
        id: 'foreign-assistant',
        role: 'assistant',
        content: 'Finished or failed explicitly.',
        timestamp: 2,
        assistantMetadata,
      },
    ]);

    expect(scheduledClaim(conversationId)).toBe('claimed');
  });

  it('rejects an apparently final tail with a later execution artifact', () => {
    const conversationId = createConversation([
      { id: 'foreign-request', role: 'user', content: 'First task.', timestamp: 1 },
      {
        id: 'foreign-assistant',
        role: 'assistant',
        content: 'Finished.',
        timestamp: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
      {
        id: 'late-tool-result',
        role: 'tool',
        toolCallId: 'tool-1',
        content: 'Late result',
        timestamp: 3,
      },
    ]);

    expect(scheduledClaim(conversationId)).toBe('unsettled_conversation_tail');
  });

  it('allows the owner for the current request to claim its own unsettled tail', () => {
    const conversationId = createConversation([
      { id: 'scheduled-request', role: 'user', content: 'Run it.', timestamp: 1 },
    ]);

    expect(
      tryClaimScheduledModelProjection({
        conversationId,
        owner: owner('scheduled-request'),
        assistantMessage: {
          id: 'scheduled-assistant',
          role: 'assistant',
          content: '',
          timestamp: 2,
        },
      }),
    ).toBe('claimed');
  });
});
