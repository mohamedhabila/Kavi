jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../../src/services/memory/database';
import { getMemoryItem } from '../../../../src/services/memory/core/memoryItemsStore';
import {
  executeMemoryForget,
  executeMemoryRemember,
  executeMemorySearch,
  MEMORY_SEARCH_MAX_LIMIT,
  type MemoryToolContext,
} from '../../../../src/services/memory/core/memoryItemsTools';
import {
  MEMORY_ITEM_TEXT_MAX_CHARS,
  resetMemoryCoreSchemaCacheForTests,
} from '../../../../src/services/memory/core/memorySchema';
import { indexMemoryTurn } from '../../../../src/services/memory/core/memoryTurnsStore';
import type { ToolRuntimeOutcome } from '../../../../src/types/toolRuntimeOutcome';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const DAY = Date.UTC(2026, 8, 14);
const HOME: MemoryToolContext = { conversationId: 'conv-1', sourceMessageId: 'u1', now: DAY };

function result(outcome: ToolRuntimeOutcome): any {
  return { outcome: outcome.status, ...JSON.parse(outcome.content) };
}

function remember(args: Record<string, unknown>, context = HOME): any {
  return result(executeMemoryRemember(args, context));
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('memory_remember', () => {
  it('saves a statement once and acknowledges a repeat', () => {
    const saved = remember({ content: 'Prefers window seats' });
    const repeat = remember({ content: 'Prefers window seats' });

    expect(saved).toEqual({
      outcome: 'completed',
      ok: true,
      status: 'saved',
      memory: {
        id: expect.any(String),
        text: 'Prefers window seats',
        date: '2026-09-14',
        scope: 'global',
      },
    });
    expect(repeat).toMatchObject({ status: 'already_saved', memory: { id: saved.memory.id } });
  });

  it('replaces the memory it corrects', () => {
    const old = remember({ content: 'Sara lives in Lisbon' });
    const corrected = remember({ content: 'Sara lives in Porto', replaces: old.memory.id });

    expect(corrected).toMatchObject({ status: 'saved', replaced: old.memory.id });
    expect(
      result(executeMemorySearch({ query: 'Sara lives' }, HOME)).memories.map(
        (memory: { text: string }) => memory.text,
      ),
    ).toEqual(['Sara lives in Porto']);
  });

  it('saves normally when the memory it names as replaced does not exist', () => {
    expect(remember({ content: 'Sara lives in Porto', replaces: 'mem_missing' })).toMatchObject({
      status: 'saved',
    });
  });

  it('keeps pinned, sensitive and conversation-only memories as asked', () => {
    const memory = remember({
      content: 'The plan draft is in notes/plan.md',
      scope: 'conversation',
      pinned: true,
      sensitive: true,
    }).memory;

    expect(memory).toMatchObject({ scope: 'conversation', pinned: true, sensitive: true });
  });

  it('never stores credentials', () => {
    expect(remember({ content: `My key is sk-proj-${'c'.repeat(24)}` })).toMatchObject({
      outcome: 'failed',
      status: 'rejected',
      error: 'restricted',
    });
  });

  it.each([
    [{}, 'non-empty'],
    [{ content: '   ' }, 'non-empty'],
    [{ content: 'x'.repeat(MEMORY_ITEM_TEXT_MAX_CHARS + 1) }, `${MEMORY_ITEM_TEXT_MAX_CHARS}`],
    [{ content: 'ok', scope: 'project' }, 'scope'],
    [{ content: 'ok', pinned: 'yes' }, 'pinned'],
  ])('rejects malformed arguments %j', (args, mentions) => {
    const rejected = remember(args);

    expect(rejected).toMatchObject({
      outcome: 'failed',
      status: 'rejected',
      error: 'invalid_arguments',
    });
    expect(rejected.message).toContain(mentions);
  });
});

describe('memory_search', () => {
  it('returns matching memories, including sensitive ones, and earlier exchanges', () => {
    remember({ content: 'Sara’s phone is +31 6 12345678' });
    indexMemoryTurn({
      conversationId: 'conv-0',
      userMessageId: 'u0',
      userText: 'Call Sara tomorrow about Porto',
      replyText: 'Reminder set.',
      at: DAY,
    });

    const found = result(executeMemorySearch({ query: 'Sara phone Porto' }, HOME));

    expect(found.memories).toEqual([
      expect.objectContaining({ text: 'Sara’s phone is +31 6 12345678', sensitive: true }),
    ]);
    expect(found.earlierConversations).toEqual([
      {
        date: '2026-09-14',
        text: 'User: Call Sara tomorrow about Porto\nAssistant: Reminder set.',
      },
    ]);
  });

  it('caps the number of memories it returns', () => {
    for (let index = 0; index < 4; index += 1) remember({ content: `Trip idea ${index}: Porto` });

    const found = result(executeMemorySearch({ query: 'Porto trip idea', limit: 2 }, HOME));

    expect(found.memories).toHaveLength(2);
  });

  it.each([[{}], [{ query: ' ' }], [{ query: 'x', limit: 0 }], [{ query: 'x', limit: 1.5 }]])(
    'rejects malformed arguments %j',
    (args) => {
      expect(result(executeMemorySearch(args, HOME))).toMatchObject({
        outcome: 'failed',
        status: 'rejected',
      });
    },
  );

  it('accepts any limit up to the maximum', () => {
    expect(
      result(executeMemorySearch({ query: 'x', limit: MEMORY_SEARCH_MAX_LIMIT + 5 }, HOME)),
    ).toMatchObject({ outcome: 'completed', memories: [] });
  });
});

describe('memory_forget', () => {
  it('deletes a memory with the versions it replaced', () => {
    const old = remember({ content: 'Sara lives in Lisbon' });
    const current = remember({ content: 'Sara lives in Porto', replaces: old.memory.id });

    expect(result(executeMemoryForget({ id: current.memory.id }, HOME))).toEqual({
      outcome: 'completed',
      ok: true,
      status: 'forgotten',
      id: current.memory.id,
    });
    expect(getMemoryItem(old.memory.id)).toBeNull();
  });

  it('reports a memory that is already gone', () => {
    expect(result(executeMemoryForget({ id: 'mem_missing' }, HOME))).toMatchObject({
      outcome: 'completed',
      status: 'not_found',
    });
  });

  it('rejects a call without an id', () => {
    expect(result(executeMemoryForget({}, HOME))).toMatchObject({
      outcome: 'failed',
      status: 'rejected',
    });
  });
});
