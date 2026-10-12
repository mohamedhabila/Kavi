jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

const mockScheduleMemoryExtraction = jest.fn();
const mockCancelMemoryExtraction = jest.fn();
jest.mock('../../../../src/services/memory/core/memoryExtractionWorker', () => ({
  scheduleMemoryExtraction: (...args: unknown[]) => mockScheduleMemoryExtraction(...args),
  cancelMemoryExtraction: () => mockCancelMemoryExtraction(),
}));

import { closeMemoryDb, getMemoryDb } from '../../../../src/services/memory/database';
import {
  ensureMemoryCoreSchema,
  resetMemoryCoreSchemaCacheForTests,
} from '../../../../src/services/memory/core/memorySchema';
import {
  catchUpMemoryCapture,
  clearAllMemory,
  deleteConversationMemory,
  publishConversationTurnMemory,
  skipMemoryCaptureToNow,
} from '../../../../src/services/memory/core/memoryCapture';
import {
  readCaptureCursor,
  recordExtractedThrough,
} from '../../../../src/services/memory/core/memoryCaptureCursor';
import { addMemoryItem } from '../../../../src/services/memory/core/memoryItemsStore';
import { recordMemoryPromptBuild } from '../../../../src/services/memory/core/memoryPromptLog';
import { searchMemoryTurns } from '../../../../src/services/memory/core/memoryTurnsStore';
import { useSettingsStore } from '../../../../src/store/useSettingsStore';
import type { Conversation } from '../../../../src/types/conversation';
import type { Message } from '../../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

type Thread = Pick<Conversation, 'id' | 'isSideThread' | 'messages'>;

function user(id: string, content: string, timestamp: number): Message {
  return { id, role: 'user', content, timestamp };
}

function reply(id: string, content: string, timestamp: number): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
  };
}

function thread(id: string, messages: Message[], extra: Partial<Thread> = {}): Thread {
  return { id, messages, ...extra };
}

function indexedTurns(query = 'kayak'): string[] {
  return searchMemoryTurns({ query, limit: 10, includeSensitive: true }).map(
    (turn) => `${turn.conversationId}/${turn.userMessageId}`,
  );
}

function rowCount(table: string): number {
  const db = getMemoryDb();
  ensureMemoryCoreSchema(db);
  return db.getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0;
}

const firstTurn = [
  user('u1', 'Book the kayak rental for Saturday', 10),
  reply('a1', 'The kayak rental is booked for Saturday.', 11),
];
const secondTurn = [
  user('u2', 'Move the kayak trip to Sunday', 20),
  reply('a2', 'Moved the kayak trip to Sunday.', 21),
];

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  mockScheduleMemoryExtraction.mockClear();
  mockCancelMemoryExtraction.mockClear();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterAll(() => {
  closeMemoryDb();
});

describe('publishing a closed turn', () => {
  it('indexes the round, marks the thread indexed through it and queues extraction', () => {
    const conversations = [thread('conv-1', firstTurn)];

    publishConversationTurnMemory('conv-1', 'a1', conversations);

    expect(indexedTurns()).toEqual(['conv-1/u1']);
    expect(readCaptureCursor('conv-1')?.indexedThroughAt).toBe(11);
    expect(mockScheduleMemoryExtraction).toHaveBeenCalledWith('conv-1');
  });

  it('is idempotent', () => {
    const conversations = [thread('conv-1', firstTurn)];

    publishConversationTurnMemory('conv-1', 'a1', conversations);
    publishConversationTurnMemory('conv-1', 'a1', conversations);

    expect(rowCount('memory_turns')).toBe(1);
  });

  it('captures nothing while memory is off, for a side thread, or for a reply that is not final', () => {
    const draft: Message = { id: 'draft', role: 'assistant', content: 'Thinking…', timestamp: 12 };
    const conversations = [
      thread('conv-1', [...firstTurn, draft]),
      thread('side-1', firstTurn, { isSideThread: true }),
    ];

    publishConversationTurnMemory('conv-1', 'draft', conversations);
    publishConversationTurnMemory('conv-1', 'missing', conversations);
    publishConversationTurnMemory('side-1', 'a1', conversations);
    useSettingsStore.setState({ disableLongTermMemory: true });
    publishConversationTurnMemory('conv-1', 'a1', conversations);

    expect(rowCount('memory_turns')).toBe(0);
    expect(mockScheduleMemoryExtraction).not.toHaveBeenCalled();
  });
});

describe('catching up after a launch', () => {
  it('captures the turns closed after the cursor and queues the thread for extraction', () => {
    publishConversationTurnMemory('conv-1', 'a1', [thread('conv-1', firstTurn)]);
    mockScheduleMemoryExtraction.mockClear();

    catchUpMemoryCapture([
      thread('conv-1', [...firstTurn, ...secondTurn]),
      thread('side-1', secondTurn, { isSideThread: true }),
    ]);

    expect(indexedTurns().sort()).toEqual(['conv-1/u1', 'conv-1/u2']);
    expect(readCaptureCursor('conv-1')?.indexedThroughAt).toBe(21);
    expect(mockScheduleMemoryExtraction.mock.calls).toEqual([['conv-1']]);
  });

  it('does not queue a thread extraction has already read', () => {
    const conversations = [thread('conv-1', firstTurn)];
    publishConversationTurnMemory('conv-1', 'a1', conversations);
    recordExtractedThrough(getMemoryDb(), 'conv-1', firstTurn[1]!.timestamp, 30);
    mockScheduleMemoryExtraction.mockClear();

    catchUpMemoryCapture(conversations);

    expect(mockScheduleMemoryExtraction).not.toHaveBeenCalled();
  });

  it('does nothing while memory is off', () => {
    useSettingsStore.setState({ disableLongTermMemory: true });

    catchUpMemoryCapture([thread('conv-1', firstTurn)]);

    expect(rowCount('memory_turns')).toBe(0);
    expect(mockScheduleMemoryExtraction).not.toHaveBeenCalled();
  });
});

describe('turning memory on', () => {
  it('never captures what was said while memory was off', () => {
    const offline = [thread('conv-1', firstTurn)];

    skipMemoryCaptureToNow(offline);
    catchUpMemoryCapture(offline);

    expect(rowCount('memory_turns')).toBe(0);
    expect(mockScheduleMemoryExtraction).not.toHaveBeenCalled();

    catchUpMemoryCapture([thread('conv-1', [...firstTurn, ...secondTurn])]);

    expect(indexedTurns()).toEqual(['conv-1/u2']);
    expect(mockScheduleMemoryExtraction).toHaveBeenCalledWith('conv-1');
  });
});

describe('deleting a conversation', () => {
  it('deletes its memories, past turns, prompt log and cursor, and nothing of another', () => {
    for (const id of ['conv-1', 'conv-2']) {
      const turn = [
        user(`${id}-u`, 'Book the kayak', 10),
        reply(`${id}-a`, 'Booked the kayak.', 11),
      ];
      publishConversationTurnMemory(id, `${id}-a`, [thread(id, turn)]);
      addMemoryItem({ text: `Kayak plans from ${id}`, conversationId: id, now: 1 });
      recordMemoryPromptBuild({
        conversationId: id,
        at: 1,
        itemIds: [],
        turnIds: [],
        chars: 0,
        durationMs: 0,
      });
    }

    deleteConversationMemory('conv-1');

    expect(indexedTurns()).toEqual(['conv-2/conv-2-u']);
    expect(rowCount('memory_items')).toBe(1);
    expect(rowCount('memory_prompt_log')).toBe(1);
    expect(readCaptureCursor('conv-1')).toBeNull();
    expect(readCaptureCursor('conv-2')).not.toBeNull();
  });
});

describe('clearing all memory', () => {
  it('stops extraction, forgets everything memory kept, and never re-captures what was said', () => {
    const conversations = [thread('conv-1', firstTurn), thread('conv-2', secondTurn)];
    publishConversationTurnMemory('conv-1', 'a1', conversations);
    publishConversationTurnMemory('conv-2', 'a2', conversations);
    addMemoryItem({ text: 'Prefers kayaking at dawn', conversationId: 'conv-1', now: 1 });
    recordMemoryPromptBuild({
      conversationId: 'conv-1',
      at: 1,
      itemIds: [],
      turnIds: [],
      chars: 0,
      durationMs: 0,
    });
    mockScheduleMemoryExtraction.mockClear();

    clearAllMemory(conversations);

    expect(mockCancelMemoryExtraction).toHaveBeenCalledTimes(1);
    expect(rowCount('memory_items')).toBe(0);
    expect(indexedTurns()).toEqual([]);
    expect(rowCount('memory_prompt_log')).toBe(0);

    catchUpMemoryCapture(conversations);

    expect(indexedTurns()).toEqual([]);
    expect(mockScheduleMemoryExtraction).not.toHaveBeenCalled();
  });
});
