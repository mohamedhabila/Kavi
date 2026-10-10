jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeTranscriptArchiveDb,
  getTranscriptArchiveDb,
} from '../../../src/services/transcriptArchive/database';
import {
  _resetTranscriptArchiveStateForTests,
  countArchivedMessages,
  deleteAllArchivedMessages,
  deleteArchivedConversation,
  drainPendingTranscriptArchive,
  isMessageArchivedOrQueued,
  loadAllArchivedMessages,
  loadArchivedMessagesPage,
  noteEvictedMessages,
  purgeArchivedConversationsExcept,
  subscribeToTranscriptArchive,
} from '../../../src/services/transcriptArchive/transcriptArchive';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function message(index: number, timestamp = 1_000 + index): Message {
  return {
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
    timestamp,
  } as Message;
}

function archive(conversationId: string, messages: Message[]): void {
  noteEvictedMessages(conversationId, messages);
  drainPendingTranscriptArchive(5_000);
}

beforeEach(() => {
  closeTranscriptArchiveDb();
  expoSqlite.__resetExpoSqliteForTests();
  _resetTranscriptArchiveStateForTests();
});

afterAll(() => {
  closeTranscriptArchiveDb();
});

describe('transcript archive', () => {
  it('keeps evicted history, once per message', () => {
    archive('c1', [message(0), message(1)]);
    archive('c1', [message(1), message(2)]);

    expect(countArchivedMessages('c1')).toBe(3);
    expect(isMessageArchivedOrQueued('c1', 'm-2')).toBe(true);
  });

  it('pages history back oldest first, newest page first', () => {
    archive(
      'c1',
      Array.from({ length: 5 }, (_unused, index) => message(index)),
    );

    const first = loadArchivedMessagesPage({ conversationId: 'c1', limit: 2 });
    expect(first.messages.map((entry) => entry.id)).toEqual(['m-3', 'm-4']);
    const second = loadArchivedMessagesPage({
      conversationId: 'c1',
      before: first.nextCursor,
      limit: 2,
    });
    expect(second.messages.map((entry) => entry.id)).toEqual(['m-1', 'm-2']);
    const last = loadArchivedMessagesPage({
      conversationId: 'c1',
      before: second.nextCursor,
      limit: 2,
    });
    expect(last.messages.map((entry) => entry.id)).toEqual(['m-0']);
    expect(last.nextCursor).toBeNull();
  });

  it('orders equal timestamps by archive order', () => {
    archive('c1', [message(0, 7), message(1, 7), message(2, 7)]);

    const page = loadArchivedMessagesPage({ conversationId: 'c1', limit: 10 });

    expect(page.messages.map((entry) => entry.id)).toEqual(['m-0', 'm-1', 'm-2']);
  });

  it('skips messages that are still shown from memory', () => {
    archive('c1', [message(0), message(1), message(2)]);
    const shown = new Set(['m-2']);

    expect(countArchivedMessages('c1', shown)).toBe(2);
    expect(
      loadArchivedMessagesPage({ conversationId: 'c1', limit: 10, excludeIds: shown }).messages.map(
        (entry) => entry.id,
      ),
    ).toEqual(['m-0', 'm-1']);
  });

  it('keeps each conversation to itself', () => {
    archive('c1', [message(0)]);
    archive('c2', [message(1)]);

    expect(countArchivedMessages('c1')).toBe(1);
    expect(loadArchivedMessagesPage({ conversationId: 'c2', limit: 5 }).messages[0]?.id).toBe(
      'm-1',
    );
  });

  it('removes a deleted conversation and every conversation on clear all', () => {
    archive('c1', [message(0)]);
    archive('c2', [message(1)]);

    deleteArchivedConversation('c1');
    expect(countArchivedMessages('c1')).toBe(0);
    expect(countArchivedMessages('c2')).toBe(1);

    deleteAllArchivedMessages();
    expect(countArchivedMessages('c2')).toBe(0);
  });

  it('purges history whose conversation no longer exists', () => {
    archive('c1', [message(0)]);
    archive('gone', [message(1)]);

    expect(purgeArchivedConversationsExcept(new Set(['c1']))).toBe(1);
    expect(countArchivedMessages('gone')).toBe(0);
    expect(countArchivedMessages('c1')).toBe(1);
  });

  it('keeps the queue when the archive cannot be written, and writes it next time', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = getTranscriptArchiveDb();
    const runSync = jest.spyOn(db, 'runSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    noteEvictedMessages('c1', [message(0)]);

    drainPendingTranscriptArchive();
    expect(countArchivedMessages('c1')).toBe(0);
    expect(warn).toHaveBeenCalled();

    runSync.mockRestore();
    drainPendingTranscriptArchive();
    expect(countArchivedMessages('c1')).toBe(1);
    warn.mockRestore();
  });

  it('tells listeners which conversation changed', () => {
    const changed: string[] = [];
    subscribeToTranscriptArchive((conversationId) => changed.push(conversationId));

    archive('c1', [message(0)]);
    deleteArchivedConversation('c1');

    expect(changed).toEqual(['c1', 'c1']);
  });

  it('skips a stored row that cannot be read', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    archive('c1', [message(0), message(1)]);
    getTranscriptArchiveDb().runSync(
      "UPDATE archived_messages SET payload = '{not json' WHERE message_id = 'm-0'",
    );

    const page = loadArchivedMessagesPage({ conversationId: 'c1', limit: 10 });

    expect(page.messages.map((entry) => entry.id)).toEqual(['m-1']);
    warn.mockRestore();
  });

  it('collects a whole conversation for export, across pages', () => {
    archive(
      'c1',
      Array.from({ length: 1_200 }, (_unused, index) => message(index)),
    );

    const all = loadAllArchivedMessages('c1', new Set(['m-5']));

    expect(all).toHaveLength(1_199);
    expect(all[0]?.id).toBe('m-0');
    expect(all.at(-1)?.id).toBe('m-1199');
    expect(all.some((entry) => entry.id === 'm-5')).toBe(false);
  });
});
