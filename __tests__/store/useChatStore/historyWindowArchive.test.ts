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
import {
  CONVERSATION_HISTORY_TOKEN_LIMIT,
  estimateStoredMessageTokens,
} from '../../../src/store/conversationHistoryWindow';
import type { Message } from '../../../src/types/message';
import { addConversation } from '../../helpers/chatConversationFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

// Messages leaving the live history went nowhere: the 500-message cap dropped them as each
// new one arrived, and compaction dropped the rounds its summary replaced, so the person
// could not scroll back to them. Both now leave for the transcript archive.

const TURN_TEXT = 'word '.repeat(4_000);

function liveMessages(conversationId: string): Message[] {
  return (
    useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)
      ?.messages ?? []
  );
}

function archivedMessageIds(conversationId: string): string[] {
  drainPendingTranscriptArchive();
  return loadAllArchivedMessages(conversationId).map((message) => message.id);
}

/** Whole turns, added through the store, while they fit the limit. */
function fillToLimit(conversationId: string): void {
  let total = 0;
  for (let turn = 0; ; turn += 1) {
    const pair: Message[] = [
      { id: `u${turn}`, role: 'user', content: TURN_TEXT, timestamp: turn * 2 },
      { id: `a${turn}`, role: 'assistant', content: 'Done.', timestamp: turn * 2 + 1 },
    ];
    const cost = pair.reduce((sum, message) => sum + estimateStoredMessageTokens(message), 0);
    if (total + cost > CONVERSATION_HISTORY_TOKEN_LIMIT) return;
    for (const message of pair) useChatStore.getState().addMessage(conversationId, message);
    total += cost;
  }
}

beforeEach(() => {
  closeTranscriptArchiveDb();
  expoSqlite.__resetExpoSqliteForTests();
  _resetTranscriptArchiveStateForTests();
});

afterAll(() => {
  closeTranscriptArchiveDb();
});

describe('the live history window', () => {
  it('moves the oldest turns to the archive when a new message passes the limit', () => {
    const id = addConversation('p1', 'system');
    fillToLimit(id);
    const before = liveMessages(id).map((message) => message.id);
    expect(archivedMessageIds(id)).toEqual([]);

    useChatStore
      .getState()
      .addMessage(id, { id: 'u-next', role: 'user', content: TURN_TEXT, timestamp: 10_000 });
    useChatStore
      .getState()
      .addMessage(id, { id: 'a-next', role: 'assistant', content: 'Done.', timestamp: 10_001 });

    const live = liveMessages(id).map((message) => message.id);
    expect(live.slice(-2)).toEqual(['u-next', 'a-next']);
    expect(live[0]).toMatch(/^u/);
    const archived = archivedMessageIds(id);
    expect(archived.length).toBeGreaterThan(0);
    // Nothing is lost: what left is archived, in order, and the rest is live.
    expect([...archived, ...live]).toEqual([...before, 'u-next', 'a-next']);
  });
});

describe('compaction', () => {
  it('archives the rounds its summary replaced', () => {
    const id = addConversation('p1', 'system');
    for (const [index, role] of (['user', 'assistant', 'user', 'assistant'] as const).entries()) {
      useChatStore
        .getState()
        .addMessage(id, { id: `m${index}`, role, content: `message ${index}`, timestamp: index });
    }
    const [, , recentUser, recentAssistant] = liveMessages(id);
    const summary: Message = {
      id: 'summary',
      role: 'system',
      content: 'Earlier: the person planned a Lisbon weekend.',
      timestamp: 5,
      compactionProvenance: { version: 1, dependency: 'transcript_only' },
    };

    useChatStore
      .getState()
      .applyConversationCompaction(id, [summary, recentUser!, recentAssistant!]);

    expect(liveMessages(id).map((message) => message.id)).toEqual(['summary', 'm2', 'm3']);
    expect(archivedMessageIds(id)).toEqual(['m0', 'm1']);
  });
});
