jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../../helpers/chatStoreHarness';
import { getTranscriptArchiveDb } from '../../../src/services/transcriptArchive/database';
import {
  countArchivedMessages,
  drainPendingTranscriptArchive,
  noteEvictedMessages,
} from '../../../src/services/transcriptArchive/transcriptArchive';
import type { Message } from '../../../src/types/message';

// Deleting a conversation removes its archived history too — and a failure to remove it
// must not undo or break the deletion; leftovers are purged on the next launch.

function archived(conversationId: string): void {
  noteEvictedMessages(conversationId, [
    { id: `${conversationId}-old`, role: 'user', content: 'old', timestamp: 1 } as Message,
  ]);
  drainPendingTranscriptArchive();
}

describe('deleting conversations with archived history', () => {
  it('removes the archived history of a deleted conversation', () => {
    const id = useChatStore.getState().createConversation('p1', 's');
    archived(id);

    useChatStore.getState().deleteConversation(id);

    expect(countArchivedMessages(id)).toBe(0);
  });

  it('removes all archived history when every conversation is cleared', () => {
    const first = useChatStore.getState().createConversation('p1', 's');
    const second = useChatStore.getState().createConversation('p2', 's');
    archived(first);
    archived(second);

    useChatStore.getState().clearAllConversations();

    expect(countArchivedMessages(first) + countArchivedMessages(second)).toBe(0);
  });

  it('still deletes the conversation when its archived history cannot be removed', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const id = useChatStore.getState().createConversation('p1', 's');
    jest.spyOn(getTranscriptArchiveDb(), 'runSync').mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => useChatStore.getState().deleteConversation(id)).not.toThrow();
    expect(useChatStore.getState().conversations.some((c) => c.id === id)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
