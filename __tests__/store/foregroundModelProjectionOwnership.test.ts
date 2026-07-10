import { useChatStore } from '../helpers/chatStoreHarness';
import {
  claimForegroundModelProjection,
  mutateOwnedForegroundModelProjection,
  ownsForegroundModelProjection,
  releaseForegroundModelProjection,
} from '../../src/store/foregroundModelProjectionOwnership';
import type { ForegroundModelProjectionOwner } from '../../src/types/conversation';

const firstOwner: ForegroundModelProjectionOwner = {
  runId: 'run-1',
  requestMessageId: 'request-1',
  assistantMessageId: 'assistant-1',
  controlEpoch: 0,
};

const secondOwner: ForegroundModelProjectionOwner = {
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

describe('foreground model projection ownership', () => {
  it('atomically claims the owner and placeholder before any model projection mutation', () => {
    const conversationId = createConversation();

    expect(
      claimForegroundModelProjection({
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
    expect(ownsForegroundModelProjection(conversationId, firstOwner)).toBe(true);
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId),
    ).toEqual(
      expect.objectContaining({
        foregroundModelProjectionOwner: firstOwner,
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'assistant-1', role: 'assistant' }),
        ]),
      }),
    );
  });

  it('rejects a stale writer before invoking its projection mutation', () => {
    const conversationId = createConversation();
    claimForegroundModelProjection({
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
      mutateOwnedForegroundModelProjection({
        conversationId,
        owner: secondOwner,
        mutate: staleMutation,
      }),
    ).toEqual({ kind: 'owner_changed' });
    expect(staleMutation).not.toHaveBeenCalled();
  });

  it('allows a new generation only after exact old-owner release and fences the old owner', () => {
    const conversationId = createConversation();
    claimForegroundModelProjection({
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
      claimForegroundModelProjection({ conversationId, owner: secondOwner }),
    ).toBe('owner_conflict');
    expect(
      releaseForegroundModelProjection({ conversationId, owner: secondOwner }),
    ).toBe('owner_changed');
    expect(
      releaseForegroundModelProjection({ conversationId, owner: firstOwner }),
    ).toBe('released');
    expect(
      claimForegroundModelProjection({ conversationId, owner: secondOwner }),
    ).toBe('claimed');

    const staleMutation = jest.fn();
    expect(
      mutateOwnedForegroundModelProjection({
        conversationId,
        owner: firstOwner,
        mutate: staleMutation,
      }),
    ).toEqual({ kind: 'owner_changed' });
    expect(staleMutation).not.toHaveBeenCalled();
  });
});
