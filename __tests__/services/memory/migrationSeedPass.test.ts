// ---------------------------------------------------------------------------
// Tests — Migration consolidation seed pass
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  clearMigrationState,
  extractSeedTurns,
  getMigrationState,
  listMigrationStates,
  runMigrationSeedPass,
  seedConversation,
} from '../../../src/services/memory/migrationSeedPass';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import type { Conversation } from '../../../src/types/conversation';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
});

afterEach(() => {
  closeMemoryDb();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function userMsg(id: string, ts: number, content = `u-${id}`): Message {
  return { id, role: 'user', content, timestamp: ts } as Message;
}
function asstMsg(id: string, ts: number, content = `a-${id}`): Message {
  return { id, role: 'assistant', content, timestamp: ts } as Message;
}
function toolMsg(id: string, ts: number): Message {
  return { id, role: 'tool', content: 't', timestamp: ts } as Message;
}

async function withExpectedWarning<T>(action: () => Promise<T>, expectedCalls = 1): Promise<T> {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const result = await action();
    expect(warnSpy).toHaveBeenCalledTimes(expectedCalls);
    return result;
  } finally {
    warnSpy.mockRestore();
  }
}

function buildConversation(
  id: string,
  turns: number,
  archived = true,
  baseTs = 1_000,
): Conversation {
  const messages: Message[] = [];
  for (let i = 0; i < turns; i += 1) {
    messages.push(userMsg(`u-${id}-${i}`, baseTs + i * 1_000));
    messages.push(asstMsg(`a-${id}-${i}`, baseTs + i * 1_000 + 500));
  }
  return {
    id,
    title: `conv ${id}`,
    persona: 'default',
    messages,
    createdAt: baseTs,
    updatedAt: baseTs + turns * 1_000,
    archivedFromMigration: archived,
  } as unknown as Conversation;
}

const PASSING_EXTRACTOR = jest.fn(async () =>
  JSON.stringify({
    new_facts: [
      {
        subject: 'user',
        predicate: 'likes',
        value: 'fact-from-seed',
        confidence: 'high',
      },
    ],
    active_focus: '',
    open_threads: [],
    notable: [],
  }),
);

beforeEach(() => {
  PASSING_EXTRACTOR.mockClear();
});

// ── extractSeedTurns ────────────────────────────────────────────────────────

describe('extractSeedTurns', () => {
  it('returns adjacent user→assistant pairs', () => {
    const messages: Message[] = [
      userMsg('u1', 1),
      asstMsg('a1', 2),
      userMsg('u2', 3),
      asstMsg('a2', 4),
    ];
    const turns = extractSeedTurns(messages, null);
    expect(turns).toHaveLength(2);
    expect(turns[0].assistantMessage.id).toBe('a1');
    expect(turns[1].assistantMessage.id).toBe('a2');
  });

  it('skips orphan user messages and tool/system messages', () => {
    const messages: Message[] = [
      { id: 's1', role: 'system', content: 'sys', timestamp: 0 } as Message,
      userMsg('u1', 1),
      userMsg('u2', 2), // orphan replaces u1 as pending
      asstMsg('a1', 3),
      toolMsg('t1', 4),
      userMsg('u3', 5),
      asstMsg('a2', 6),
    ];
    const turns = extractSeedTurns(messages, null);
    expect(turns).toHaveLength(2);
    expect(turns[0].userMessage.id).toBe('u2');
    expect(turns[1].userMessage.id).toBe('u3');
  });

  it('starts strictly after the anchor message id', () => {
    const messages: Message[] = [
      userMsg('u1', 1),
      asstMsg('a1', 2),
      userMsg('u2', 3),
      asstMsg('a2', 4),
    ];
    const turns = extractSeedTurns(messages, 'a1');
    expect(turns).toHaveLength(1);
    expect(turns[0].assistantMessage.id).toBe('a2');
  });

  it('skips pairs where either side is empty', () => {
    const messages: Message[] = [
      userMsg('u1', 1, ''),
      asstMsg('a1', 2),
      userMsg('u2', 3),
      asstMsg('a2', 4, '   '),
    ];
    expect(extractSeedTurns(messages, null)).toHaveLength(0);
  });
});

// ── seedConversation ────────────────────────────────────────────────────────

describe('seedConversation', () => {
  it('returns "completed" with no work when conversation has no turns', async () => {
    const conv = buildConversation('empty', 0);
    const result = await seedConversation({
      conversation: conv,
      extractor: PASSING_EXTRACTOR,
    });
    expect(result.status).toBe('completed');
    expect(result.seededTurns).toBe(0);
    expect(getMigrationState('empty')?.status).toBe('completed');
    expect(PASSING_EXTRACTOR).not.toHaveBeenCalled();
  });

  it('seeds all turns when under cap and persists facts', async () => {
    const conv = buildConversation('c1', 2);
    const result = await seedConversation({
      conversation: conv,
      extractor: PASSING_EXTRACTOR,
    });
    expect(result.status).toBe('completed');
    expect(result.seededTurns).toBe(2);
    expect(result.remainingTurns).toBe(0);
    expect(PASSING_EXTRACTOR).toHaveBeenCalledTimes(2);
    const state = getMigrationState('c1');
    expect(state?.lastSeededMessageId).toBe('a-c1-1');
    expect(state?.seededTurns).toBe(2);
    expect(state?.status).toBe('completed');
    // Facts persisted (idempotent dedupe — at least one seeded fact).
    expect(listFacts({ limit: 10 }).length).toBeGreaterThan(0);
  });

  it('honours maxTurnsPerCall and resumes from cursor on second call', async () => {
    const conv = buildConversation('c2', 3);
    const first = await seedConversation({
      conversation: conv,
      extractor: PASSING_EXTRACTOR,
      maxTurnsPerCall: 2,
    });
    expect(first.status).toBe('in_progress');
    expect(first.seededTurns).toBe(2);
    expect(first.remainingTurns).toBe(1);
    expect(getMigrationState('c2')?.lastSeededMessageId).toBe('a-c2-1');

    const second = await seedConversation({
      conversation: conv,
      extractor: PASSING_EXTRACTOR,
      maxTurnsPerCall: 2,
    });
    expect(second.status).toBe('completed');
    expect(second.seededTurns).toBe(1);
    expect(getMigrationState('c2')?.lastSeededMessageId).toBe('a-c2-2');
    expect(PASSING_EXTRACTOR).toHaveBeenCalledTimes(3);
  });

  it('captures extractor errors without throwing and marks status=error', async () => {
    const conv = buildConversation('c3', 2);
    const failing = jest.fn(async () => {
      throw new Error('boom');
    });
    const result = await withExpectedWarning(() =>
      seedConversation({ conversation: conv, extractor: failing }),
    );
    expect(result.status).toBe('error');
    expect(result.error).toBe('boom');
    const state = getMigrationState('c3');
    expect(state?.status).toBe('error');
    expect(state?.error).toBe('boom');
    expect(state?.seededTurns).toBe(0);
  });

  it('re-running after an extractor error and a fix succeeds', async () => {
    const conv = buildConversation('c4', 1);
    const failing = jest.fn(async () => {
      throw new Error('first-time');
    });
    await withExpectedWarning(() => seedConversation({ conversation: conv, extractor: failing }));
    expect(getMigrationState('c4')?.status).toBe('error');

    const recovered = await seedConversation({
      conversation: conv,
      extractor: PASSING_EXTRACTOR,
    });
    expect(recovered.status).toBe('completed');
    expect(getMigrationState('c4')?.status).toBe('completed');
    expect(getMigrationState('c4')?.error).toBeNull();
  });

  it('short-circuits when a conversation is already completed', async () => {
    const conv = buildConversation('c5', 1);
    await seedConversation({ conversation: conv, extractor: PASSING_EXTRACTOR });
    PASSING_EXTRACTOR.mockClear();
    const result = await seedConversation({
      conversation: conv,
      extractor: PASSING_EXTRACTOR,
    });
    expect(result.status).toBe('completed');
    expect(PASSING_EXTRACTOR).not.toHaveBeenCalled();
  });

  it('rejects an invalid conversation', async () => {
    const result = await seedConversation({
      // @ts-expect-error invalid input
      conversation: {},
      extractor: PASSING_EXTRACTOR,
    });
    expect(result.status).toBe('error');
    expect(result.error).toBe('invalid_conversation');
  });
});

// ── runMigrationSeedPass ────────────────────────────────────────────────────

describe('runMigrationSeedPass', () => {
  it('is a no-op when disableLongTermMemory is true', async () => {
    const conversations = [buildConversation('c1', 2)];
    const result = await runMigrationSeedPass({
      conversations,
      extractor: PASSING_EXTRACTOR,
      disableLongTermMemory: true,
    });
    expect(result.attempted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(PASSING_EXTRACTOR).not.toHaveBeenCalled();
  });

  it('is a no-op when no extractor is supplied', async () => {
    const conversations = [buildConversation('c1', 2)];
    const result = await runMigrationSeedPass({
      conversations,
      extractor: null,
    });
    expect(result.attempted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('returns zero counters when no archived conversations exist', async () => {
    const conversations = [buildConversation('c1', 2, false)];
    const result = await runMigrationSeedPass({
      conversations,
      extractor: PASSING_EXTRACTOR,
    });
    expect(result).toMatchObject({
      attempted: 0,
      completed: 0,
      errors: 0,
      remainingConversations: 0,
    });
  });

  it('processes conversations oldest-first up to maxConversationsPerCall', async () => {
    const a = buildConversation('newer', 1, true, 5_000);
    const b = buildConversation('older', 1, true, 1_000);
    const c = buildConversation('middle', 1, true, 3_000);
    const result = await runMigrationSeedPass({
      conversations: [a, b, c],
      extractor: PASSING_EXTRACTOR,
      maxConversationsPerCall: 2,
    });
    expect(result.attempted).toBe(2);
    expect(result.completed).toBe(2);
    expect(result.remainingConversations).toBe(1);
    expect(result.pending).toEqual(['newer']);
    expect(getMigrationState('older')?.status).toBe('completed');
    expect(getMigrationState('middle')?.status).toBe('completed');
    expect(getMigrationState('newer')).toBeNull();
  });

  it('continues after a per-conversation error', async () => {
    const ok = buildConversation('ok', 1);
    const bad = buildConversation('bad', 1);
    const flaky = jest.fn(async (...args: unknown[]) => {
      void args;
      // First call throws (bad — older), second succeeds (ok — newer).
      if (flaky.mock.calls.length === 1) throw new Error('extractor down');
      return JSON.stringify({
        new_facts: [],
        active_focus: '',
        open_threads: [],
        notable: [],
      });
    });
    // bad has older updatedAt
    bad.updatedAt = 1_000;
    ok.updatedAt = 5_000;
    const result = await withExpectedWarning(() =>
      runMigrationSeedPass({
        conversations: [ok, bad],
        extractor: flaky,
      }),
    );
    expect(result.attempted).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.completed).toBe(1);
    expect(getMigrationState('bad')?.status).toBe('error');
    expect(getMigrationState('ok')?.status).toBe('completed');
  });

  it('skips already-completed conversations on subsequent passes', async () => {
    const conv = buildConversation('c1', 1);
    await runMigrationSeedPass({
      conversations: [conv],
      extractor: PASSING_EXTRACTOR,
    });
    PASSING_EXTRACTOR.mockClear();
    const second = await runMigrationSeedPass({
      conversations: [conv],
      extractor: PASSING_EXTRACTOR,
    });
    expect(second.skipped).toBe(1);
    expect(second.attempted).toBe(0);
    expect(PASSING_EXTRACTOR).not.toHaveBeenCalled();
  });
});

// ── State CRUD ──────────────────────────────────────────────────────────────

describe('migration state CRUD', () => {
  it('returns null for an unknown conversation', () => {
    expect(getMigrationState('does-not-exist')).toBeNull();
  });

  it('listMigrationStates returns rows ordered by updatedAt desc', async () => {
    await seedConversation({
      conversation: buildConversation('a', 1),
      extractor: PASSING_EXTRACTOR,
      now: 1_000,
    });
    await seedConversation({
      conversation: buildConversation('b', 1),
      extractor: PASSING_EXTRACTOR,
      now: 2_000,
    });
    const states = listMigrationStates();
    expect(states.map((s) => s.conversationId)).toEqual(['b', 'a']);
  });

  it('clearMigrationState removes a row', async () => {
    await seedConversation({
      conversation: buildConversation('a', 1),
      extractor: PASSING_EXTRACTOR,
    });
    expect(getMigrationState('a')).not.toBeNull();
    clearMigrationState('a');
    expect(getMigrationState('a')).toBeNull();
  });
});
