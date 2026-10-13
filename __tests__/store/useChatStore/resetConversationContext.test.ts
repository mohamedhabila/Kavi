jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../../helpers/chatStoreHarness';
import { closeTranscriptArchiveDb } from '../../../src/services/transcriptArchive/database';
import {
  _resetTranscriptArchiveStateForTests,
  drainPendingTranscriptArchive,
  loadAllArchivedMessages,
} from '../../../src/services/transcriptArchive/transcriptArchive';
import type { Message } from '../../../src/types/message';
import { addConversation } from '../../helpers/chatConversationFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

// Kavi is one conversation: starting over moves its messages out of what the model reads
// and into the transcript archive, where the person can still scroll back to them.

function seedConversation(): string {
  const id = addConversation('p1', 'system');
  const messages: Array<Pick<Message, 'id' | 'role' | 'content'>> = [
    { id: 'u1', role: 'user', content: 'Plan the Lisbon weekend' },
    { id: 'a1', role: 'assistant', content: 'Day one Alfama, day two Sintra.' },
    { id: 'u2', role: 'user', content: 'Book the Sintra train' },
    { id: 'a2', role: 'assistant', content: 'Booking it now.' },
  ];
  for (const message of messages) useChatStore.getState().addMessage(id, message);
  return id;
}

function liveMessageIds(conversationId: string): string[] {
  return (
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.map((message) => message.id) ?? []
  );
}

function archivedMessageIds(conversationId: string): string[] {
  drainPendingTranscriptArchive();
  return loadAllArchivedMessages(conversationId).map((message) => message.id);
}

beforeEach(() => {
  closeTranscriptArchiveDb();
  expoSqlite.__resetExpoSqliteForTests();
  _resetTranscriptArchiveStateForTests();
});

afterAll(() => {
  closeTranscriptArchiveDb();
});

describe('resetting a conversation’s context', () => {
  it('moves its messages to the transcript archive', () => {
    const id = seedConversation();

    expect(useChatStore.getState().resetConversationContext(id)).toBe(true);

    expect(liveMessageIds(id)).toEqual([]);
    expect(archivedMessageIds(id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('keeps the messages of a run still in progress', () => {
    const id = seedConversation();
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id
          ? {
              ...conversation,
              modelProjectionOwner: {
                surface: 'foreground',
                runId: 'run-2',
                requestMessageId: 'u2',
                assistantMessageId: 'a2',
                controlEpoch: 1,
              },
            }
          : conversation,
      ),
    }));

    expect(useChatStore.getState().resetConversationContext(id)).toBe(true);

    expect(liveMessageIds(id)).toEqual(['u2', 'a2']);
    expect(archivedMessageIds(id)).toEqual(['u1', 'a1']);
  });

  it('reports false when there is nothing to reset', () => {
    const id = addConversation('p1', 'system');

    expect(useChatStore.getState().resetConversationContext(id)).toBe(false);
    expect(useChatStore.getState().resetConversationContext('missing')).toBe(false);
  });
});
