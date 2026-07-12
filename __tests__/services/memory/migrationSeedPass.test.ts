// ---------------------------------------------------------------------------
// Tests — Migration consolidation seed pass
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { getEpisodeAccessPolicy } from '../../../src/services/memory/episodes/accessPolicyStore';
import {
  extractSeedTurns,
  runMigrationSeedPass,
  seedConversation,
} from '../../../src/services/memory/migrationSeedPass';
import {
  clearMigrationState,
  getMigrationState,
  listMigrationStates,
  MIGRATION_CLAIM_LEASE_MS,
} from '../../../src/services/memory/migrationStateStore';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  editPromptEligibleWorkingBlock,
  getWorkingBlock,
} from '../../../src/services/memory/workingBlocks';
import type { Conversation } from '../../../src/types/conversation';
import type { Message } from '../../../src/types/message';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  initializeMemoryPolicyObservation();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
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
        confidence: 0.9,
      },
    ],
    episode_summary: null,
    active_focus: null,
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
  it('cancels an in-flight seed across opt-out and re-enable without persisting', async () => {
    let resolveExtractor: ((value: string) => void) | undefined;
    const extractor = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveExtractor = resolve;
        }),
    );
    const conversation = buildConversation('in-flight-opt-out', 1);
    const pending = seedConversation({ conversation, extractor });
    for (let round = 0; round < 5; round += 1) await Promise.resolve();
    expect(extractor).toHaveBeenCalledTimes(1);

    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    useSettingsStore.setState({ disableLongTermMemory: false } as never);
    resolveExtractor?.(
      JSON.stringify({
        new_facts: [
          {
            subject: 'user',
            predicate: 'likes',
            value: 'must-not-persist',
            confidence: 0.9,
          },
        ],
        episode_summary: null,
        active_focus: null,
        open_threads: [],
        notable: [],
      }),
    );

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ status: 'pending', claimOutcome: 'cancelled', seededTurns: 0 }),
    );
    expect(listFacts({ originConversationId: conversation.id })).toEqual([]);
    expect(getMigrationState(conversation.id)).toEqual(
      expect.objectContaining({ status: 'pending', claimExpiresAt: null }),
    );
  });

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

  it('binds historical migration episodes thread-only without inferring session sharing', async () => {
    const conversation = buildConversation('historical-policy', 1);
    conversation.personaId = 'historical-persona';
    const extractor = jest.fn(async () =>
      JSON.stringify({
        new_facts: [],
        episode_summary: 'Historical release context',
        active_focus: null,
        open_threads: [],
        notable: [],
      }),
    );

    await seedConversation({ conversation, extractor, now: 3_000 });

    const episode = listEpisodes({ conversationId: conversation.id })[0];
    expect(episode).toBeDefined();
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode.id)).toMatchObject({
      scope: {
        memoryConversationId: conversation.id,
        sourceThreadId: conversation.id,
        personaId: 'historical-persona',
        taskId: null,
      },
      shareability: 'thread_only',
      sensitivity: 'normal',
    });
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
    const result = await seedConversation({ conversation: conv, extractor: failing });
    expect(result.status).toBe('error');
    expect(result.error).toBe('provider_request_failed');
    const state = getMigrationState('c3');
    expect(state?.status).toBe('error');
    expect(state?.error).toBe('provider_request_failed');
    expect(state?.seededTurns).toBe(0);
  });

  it('re-running after an extractor error and a fix succeeds', async () => {
    const conv = buildConversation('c4', 1);
    const failing = jest.fn(async () => {
      throw new Error('first-time');
    });
    await seedConversation({ conversation: conv, extractor: failing });
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

  it('does not advance or clear another conversation on malformed enrichment', async () => {
    const conv = buildConversation('malformed', 1);
    editPromptEligibleWorkingBlock('open_threads', 'other conversation sentinel', {
      conversationId: 'other-conversation',
      threadId: 'other-thread',
    });

    const result = await seedConversation({
      conversation: conv,
      extractor: async () => '{invalid',
    });

    expect(result).toMatchObject({
      status: 'error',
      seededTurns: 0,
      error: 'invalid_json',
    });
    expect(getMigrationState(conv.id)?.lastSeededMessageId).toBeNull();
    expect(
      getWorkingBlock('open_threads', {
        conversationId: 'other-conversation',
        threadId: 'other-thread',
      })?.content,
    ).toBe('other conversation sentinel');
  });

  it('writes migration working memory only in the source conversation namespace', async () => {
    const conv = buildConversation('scoped-migration', 1);
    editPromptEligibleWorkingBlock('open_threads', 'other conversation sentinel', {
      conversationId: 'other-conversation',
      threadId: 'other-thread',
    });
    const extractor = async () =>
      JSON.stringify({
        new_facts: [],
        episode_summary: null,
        active_focus: null,
        open_threads: ['Scoped follow-up'],
        notable: [],
      });

    await seedConversation({ conversation: conv, extractor });

    expect(
      getWorkingBlock('open_threads', {
        conversationId: 'other-conversation',
        threadId: 'other-thread',
      })?.content,
    ).toBe('other conversation sentinel');
    expect(
      getWorkingBlock('open_threads', {
        conversationId: conv.id,
        threadId: conv.id,
      })?.content,
    ).toBe('Scoped follow-up');
  });

  it('fences an expired owner before it can persist after claim recovery', async () => {
    const conv = buildConversation('fenced-stale-owner', 1);
    let releaseFirst!: () => void;
    let notifyFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      notifyFirstStarted = resolve;
    });
    const firstExtractor = jest.fn(async () => {
      notifyFirstStarted();
      await firstGate;
      return JSON.stringify({
        new_facts: [],
        episode_summary: null,
        active_focus: null,
        open_threads: ['stale owner write'],
        notable: [],
      });
    });
    const recoveredExtractor = jest.fn(async () =>
      JSON.stringify({
        new_facts: [],
        episode_summary: null,
        active_focus: null,
        open_threads: ['recovered owner write'],
        notable: [],
      }),
    );

    const firstPromise = seedConversation({
      conversation: conv,
      extractor: firstExtractor,
      now: 30_000,
    });
    await firstStarted;
    const recovered = await seedConversation({
      conversation: conv,
      extractor: recoveredExtractor,
      now: 30_000 + MIGRATION_CLAIM_LEASE_MS,
    });
    releaseFirst();
    const staleOwner = await firstPromise;

    expect(recovered).toMatchObject({ status: 'completed', seededTurns: 1 });
    expect(staleOwner).toMatchObject({
      status: 'error',
      seededTurns: 0,
      error: 'claim_lost',
    });
    expect(
      getWorkingBlock('open_threads', {
        conversationId: conv.id,
        threadId: conv.id,
      })?.content,
    ).toBe('recovered owner write');
    expect(getMigrationState(conv.id)).toMatchObject({
      status: 'completed',
      seededTurns: 1,
      error: null,
    });
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
  it('lets only one concurrent pass claim a conversation', async () => {
    const conv = buildConversation('concurrent-claim', 1);
    let releaseExtractor!: () => void;
    let notifyStarted!: () => void;
    const extractorGate = new Promise<void>((resolve) => {
      releaseExtractor = resolve;
    });
    const extractorStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const extractor = jest.fn(async () => {
      notifyStarted();
      await extractorGate;
      return JSON.stringify({
        new_facts: [],
        episode_summary: null,
        active_focus: null,
        open_threads: [],
        notable: [],
      });
    });

    const firstPromise = runMigrationSeedPass({
      conversations: [conv],
      extractor,
      now: 10_000,
    });
    await extractorStarted;
    const second = await runMigrationSeedPass({
      conversations: [conv],
      extractor,
      now: 10_000,
    });

    expect(second).toMatchObject({
      attempted: 0,
      skipped: 1,
      remainingConversations: 1,
      pending: [conv.id],
    });
    expect(extractor).toHaveBeenCalledTimes(1);

    releaseExtractor();
    const first = await firstPromise;
    expect(first).toMatchObject({ attempted: 1, completed: 1, errors: 0 });
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(getMigrationState(conv.id)).toMatchObject({
      status: 'completed',
      claimExpiresAt: null,
    });
  });

  it('recovers a claim deterministically at the expiry boundary', async () => {
    const conv = buildConversation('stale-claim', 1);
    getMemoryDb().runSync(
      `INSERT INTO memory_migration_state (
         conversation_id, last_seeded_message_id, seeded_turns, status, error,
         claim_token, claim_expires_at, updated_at
       ) VALUES (?, NULL, 0, 'in_progress', NULL, 'abandoned-claim', ?, ?)`,
      conv.id,
      20_000,
      19_000,
    );

    const result = await runMigrationSeedPass({
      conversations: [conv],
      extractor: PASSING_EXTRACTOR,
      now: 20_000,
    });

    expect(result).toMatchObject({ attempted: 1, completed: 1, errors: 0 });
    expect(PASSING_EXTRACTOR).toHaveBeenCalledTimes(1);
    expect(
      getMemoryDb().getFirstSync<{
        status: string;
        claim_token: string | null;
        claim_expires_at: number | null;
      }>(
        `SELECT status, claim_token, claim_expires_at
           FROM memory_migration_state
          WHERE conversation_id = ?`,
        conv.id,
      ),
    ).toEqual({
      status: 'completed',
      claim_token: null,
      claim_expires_at: null,
    });
  });

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
        episode_summary: null,
        active_focus: null,
        open_threads: [],
        notable: [],
      });
    });
    // bad has older updatedAt
    bad.updatedAt = 1_000;
    ok.updatedAt = 5_000;
    const result = await runMigrationSeedPass({
      conversations: [ok, bad],
      extractor: flaky,
    });
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
