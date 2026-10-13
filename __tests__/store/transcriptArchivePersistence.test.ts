jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { partializeChatPersistState } from '../../src/store/chatPersistence';
import { _setPersistedGenerationBoundaryHookForTests } from '../../src/store/persistedFileGenerations';
import {
  _resetThrottledStorageStateForTests,
  createThrottledJSONStorage,
  flushPendingStorageWrites,
} from '../../src/store/throttledStorage';
import { closeTranscriptArchiveDb } from '../../src/services/transcriptArchive/database';
import {
  _resetTranscriptArchiveStateForTests,
  countArchivedMessages,
  drainPendingTranscriptArchive,
  noteEvictedMessages,
} from '../../src/services/transcriptArchive/transcriptArchive';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

// A conversation persisted only its newest ~500 messages; older ones were dropped at save
// time, so a person who kept one conversation lost its history after a restart. The live
// history window now moves leaving messages to the archive (historyWindowArchive.test.ts),
// durably, before the save that omits them; a save itself drops nothing.

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const expoFileSystemMock = jest.requireMock('expo-file-system') as { __resetStore: () => void };

function conversationWith(count: number): Conversation {
  const messages = Array.from(
    { length: count },
    (_unused, index) =>
      ({
        id: `m-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message ${index}`,
        timestamp: 1_000 + index,
      }) as Message,
  );
  return {
    id: 'c1',
    title: 'One conversation',
    providerId: 'p',
    messages,
    createdAt: 1,
    updatedAt: 1,
  } as Conversation;
}

beforeEach(() => {
  closeTranscriptArchiveDb();
  expoSqlite.__resetExpoSqliteForTests();
  expoFileSystemMock.__resetStore();
  _resetTranscriptArchiveStateForTests();
  _resetThrottledStorageStateForTests();
  _setPersistedGenerationBoundaryHookForTests(null);
});

afterAll(() => {
  _setPersistedGenerationBoundaryHookForTests(null);
  closeTranscriptArchiveDb();
});

describe('a save', () => {
  it('keeps every live message and archives none of them', () => {
    const persisted = partializeChatPersistState({
      conversations: [conversationWith(600)],
      activeConversationId: 'c1',
    }).conversations[0]!;
    drainPendingTranscriptArchive();

    expect(persisted.messages).toHaveLength(600);
    expect(countArchivedMessages('c1')).toBe(0);
  });
});

describe('the commit that omits archived history', () => {
  it('runs only after the archive is written', async () => {
    const events: string[] = [];
    _setPersistedGenerationBoundaryHookForTests((event) => {
      if (event.boundary === 'temp_write' && event.phase === 'before') events.push('commit');
    });
    const storage = createThrottledJSONStorage<{ value: number }>({
      beforeCommit: () => events.push('archive'),
    });

    await storage.setItem('chat', { state: { value: 1 }, version: 1 });
    await flushPendingStorageWrites('chat');

    expect(events).toEqual(['archive', 'commit']);
  });

  it('leaves history archived even when the commit fails', async () => {
    _setPersistedGenerationBoundaryHookForTests((event) => {
      if (event.boundary === 'temp_write' && event.phase === 'before') {
        throw new Error('disk full');
      }
    });
    noteEvictedMessages('c1', conversationWith(2).messages);
    const storage = createThrottledJSONStorage<{ value: number }>({
      beforeCommit: () => drainPendingTranscriptArchive(),
    });

    await storage.setItem('chat', { state: { value: 1 }, version: 1 });
    await expect(flushPendingStorageWrites('chat')).rejects.toThrow('disk full');

    expect(countArchivedMessages('c1')).toBe(2);
  });
});
