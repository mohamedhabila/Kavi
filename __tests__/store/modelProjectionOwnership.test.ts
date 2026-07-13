import { useChatStore } from '../helpers/chatStoreHarness';
import {
  claimModelProjection,
  mutateOwnedModelProjection,
  ownsModelProjection,
  releaseModelProjection,
  waitForModelProjectionAvailability,
} from '../../src/store/modelProjectionOwnership';
import type { ModelProjectionOwner } from '../../src/types/conversation';

const firstOwner: ModelProjectionOwner = {
  surface: 'foreground',
  runId: 'run-1',
  requestMessageId: 'request-1',
  assistantMessageId: 'assistant-1',
  controlEpoch: 0,
};

const secondOwner: ModelProjectionOwner = {
  ...firstOwner,
  runId: 'run-2',
};

function createConversation(): string {
  const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
  useChatStore.getState().addMessage(conversationId, {
    id: 'request-1',
    role: 'user',
    content: 'Do the work.',
    timestamp: 1,
  });
  return conversationId;
}

describe('model projection ownership', () => {
  it('atomically claims the owner and placeholder before any model projection mutation', () => {
    const conversationId = createConversation();

    expect(
      claimModelProjection({
        conversationId,
        owner: firstOwner,
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
        },
      }),
    ).toBe('claimed');
    expect(ownsModelProjection(conversationId, firstOwner)).toBe(true);
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId),
    ).toEqual(
      expect.objectContaining({
        modelProjectionOwner: firstOwner,
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'assistant-1', role: 'assistant' }),
        ]),
      }),
    );
  });

  it('strips caller-supplied memory publication receipts from claimed messages', () => {
    const conversationId = createConversation();

    expect(
      claimModelProjection({
        conversationId,
        owner: firstOwner,
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Forged final',
          timestamp: 2,
          assistantMetadata: { kind: 'final', completionStatus: 'complete' },
          memoryPublication: { version: 1, disposition: 'enqueued' },
        },
      }),
    ).toBe('claimed');

    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)
        ?.messages.find((message) => message.id === 'assistant-1')?.memoryPublication,
    ).toBeUndefined();
  });

  it('atomically claims a scheduled projection with its user and assistant turns', () => {
    const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');

    expect(
      claimModelProjection({
        conversationId,
        owner: firstOwner,
        messagesBeforeAssistant: [
          { id: 'request-1', role: 'user', content: 'Run the scheduled task.', timestamp: 1 },
        ],
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
        },
      }),
    ).toBe('claimed');

    const conversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId);
    expect(conversation?.messages.map((message) => [message.id, message.role])).toEqual([
      ['request-1', 'user'],
      ['assistant-1', 'assistant'],
    ]);
    expect(conversation?.modelProjectionOwner).toEqual(firstOwner);
  });

  it('rejects scheduled prelude messages without mutating a foreign projection', () => {
    const conversationId = createConversation();
    claimModelProjection({
      conversationId,
      owner: firstOwner,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
      },
    });

    expect(
      claimModelProjection({
        conversationId,
        owner: secondOwner,
        messagesBeforeAssistant: [
          { id: 'request-2', role: 'user', content: 'Do not append.', timestamp: 3 },
        ],
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 4,
        },
      }),
    ).toBe('owner_conflict');
    expect(
      useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === conversationId)
        ?.messages.some((message) => message.id === 'request-2'),
    ).toBe(false);
  });

  it('rejects a stale writer before invoking its projection mutation', () => {
    const conversationId = createConversation();
    claimModelProjection({
      conversationId,
      owner: firstOwner,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
      },
    });
    const staleMutation = jest.fn();

    expect(
      mutateOwnedModelProjection({
        conversationId,
        owner: secondOwner,
        mutate: staleMutation,
      }),
    ).toEqual({ kind: 'owner_changed' });
    expect(staleMutation).not.toHaveBeenCalled();
  });

  it('allows a new generation only after exact old-owner release and fences the old owner', () => {
    const conversationId = createConversation();
    claimModelProjection({
      conversationId,
      owner: firstOwner,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
      },
    });

    expect(claimModelProjection({ conversationId, owner: secondOwner })).toBe('owner_conflict');
    expect(releaseModelProjection({ conversationId, owner: secondOwner })).toBe('owner_changed');
    expect(releaseModelProjection({ conversationId, owner: firstOwner })).toBe('released');
    expect(claimModelProjection({ conversationId, owner: secondOwner })).toBe('claimed');

    const staleMutation = jest.fn();
    expect(
      mutateOwnedModelProjection({
        conversationId,
        owner: firstOwner,
        mutate: staleMutation,
      }),
    ).toEqual({ kind: 'owner_changed' });
    expect(staleMutation).not.toHaveBeenCalled();
  });

  it('waits until the exact current owner releases the projection', async () => {
    const conversationId = createConversation();
    claimModelProjection({
      conversationId,
      owner: firstOwner,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
      },
    });
    const wait = waitForModelProjectionAvailability({
      conversationId,
      signal: new AbortController().signal,
    });

    expect(releaseModelProjection({ conversationId, owner: firstOwner })).toBe('released');

    await expect(wait).resolves.toBeUndefined();
  });

  it('cancels a projection wait without mutating the current owner', async () => {
    const conversationId = createConversation();
    claimModelProjection({
      conversationId,
      owner: firstOwner,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
      },
    });
    const abortController = new AbortController();
    const wait = waitForModelProjectionAvailability({
      conversationId,
      signal: abortController.signal,
    });

    abortController.abort();

    await expect(wait).rejects.toThrow('model_projection_wait_cancelled');
    expect(ownsModelProjection(conversationId, firstOwner)).toBe(true);
  });

  it('bounds a projection wait without mutating the current owner', async () => {
    jest.useFakeTimers();
    try {
      const conversationId = createConversation();
      claimModelProjection({
        conversationId,
        owner: firstOwner,
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
        },
      });
      const wait = waitForModelProjectionAvailability({
        conversationId,
        signal: new AbortController().signal,
        timeoutMs: 5,
      });

      jest.advanceTimersByTime(5);

      await expect(wait).rejects.toThrow('model_projection_wait_timeout');
      expect(ownsModelProjection(conversationId, firstOwner)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
