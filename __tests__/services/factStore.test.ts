// ---------------------------------------------------------------------------
// Tests — Fact / Entity / Block Store (bi-temporal memory primitives)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { upsertEntity } from '../../src/services/memory/entities';
import {
  invalidateFact,
  markFactsRecalled,
  recordFact,
  recordFactWithApplicability,
  setFactLocalSimilarity,
  setFactPinned,
} from '../../src/services/memory/facts/mutations';
import { replaceCurrentFact } from '../../src/services/memory/facts/exactReplacement';
import { hasExactFactContentIdentity } from '../../src/services/memory/facts/contentIdentity';
import { withdrawMemoryFact } from '../../src/services/memory/withdrawal';
import {
  countFacts,
  countFactsByKind,
  getFactById,
  listFacts,
} from '../../src/services/memory/facts/queries';
import { createCurrentLocalSimilarityVector } from '../../src/services/memory/localSimilarity';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

// ── Bi-temporal facts ───────────────────────────────────────────────────

describe('recordFact', () => {
  let userId: string;
  beforeEach(() => {
    userId = upsertEntity({ name: 'self', type: 'self' }).id;
  });

  it('creates a new fact with valid_at default to now', () => {
    const t0 = Date.now();
    const result = recordFact({
      subjectId: userId,
      predicate: 'lives_in',
      objectText: 'Cairo',
      scope: 'global',
      now: t0,
    });
    expect(result.status).toBe('created');
    expect(result.fact.validAt).toBe(t0);
    expect(result.fact.invalidAt).toBeNull();
    expect(result.superseded).toEqual([]);
  });

  it('dedupes identical content_hash without creating a duplicate row', () => {
    const a = recordFact({
      subjectId: userId,
      predicate: 'works_at',
      objectText: 'Acme',
      scope: 'global',
    });
    const b = recordFact({
      subjectId: userId,
      predicate: 'works_at',
      objectText: 'Acme',
      scope: 'global',
    });
    expect(b.status).toBe('duplicate');
    expect(b.fact.id).toBe(a.fact.id);
    expect(listFacts({ subjectId: userId, predicate: 'works_at' })).toHaveLength(1);
  });

  it('uses scope-aware exact identity after the hash candidate lookup', () => {
    const global = recordFact({
      subjectId: userId,
      predicate: 'timezone',
      objectText: 'UTC+1',
      scope: 'global',
    });
    const globalReplay = recordFact({
      subjectId: userId,
      predicate: 'timezone',
      objectText: 'UTC+1',
      scope: 'global',
    });
    expect(globalReplay.status).toBe('duplicate');
    expect(globalReplay.fact.id).toBe(global.fact.id);

    const conversation = recordFact({
      subjectId: userId,
      predicate: 'display_name',
      objectText: 'Mo',
      scope: 'conversation',
      originConversationId: 'conversation-a',
      originThreadId: 'thread-a',
    });
    const conversationReplay = recordFact({
      subjectId: userId,
      predicate: 'display_name',
      objectText: 'Mo',
      scope: 'conversation',
      originConversationId: 'conversation-a',
      originThreadId: 'thread-b',
    });
    expect(conversationReplay.status).toBe('duplicate');
    expect(conversationReplay.fact.id).toBe(conversation.fact.id);

    const canonicalText = recordFact({
      subjectId: userId,
      predicate: 'favorite_cafe',
      objectText: 'Cafe\u0301',
      scope: 'global',
    });
    const canonicalTextReplay = recordFact({
      subjectId: userId,
      predicate: 'favorite_cafe',
      objectText: 'Caf\u00e9',
      scope: 'global',
    });
    expect(canonicalTextReplay.status).toBe('duplicate');
    expect(canonicalTextReplay.fact.id).toBe(canonicalText.fact.id);

    const projectA = recordFact({
      subjectId: userId,
      predicate: 'release',
      objectText: 'v1',
      scope: 'project',
      originConversationId: 'conversation-a',
      originThreadId: 'thread-a',
    });
    const projectB = recordFact({
      subjectId: userId,
      predicate: 'release',
      objectText: 'v1',
      scope: 'project',
      originConversationId: 'conversation-a',
      originThreadId: 'thread-b',
    });
    expect(projectB.status).toBe('duplicate');
    expect(projectB.fact.id).toBe(projectA.fact.id);
  });

  it('treats the memory owner as part of exact content identity', () => {
    const identity = {
      memoryOwnerId: 'owner-a',
      memoryKind: 'semantic_fact',
      scope: 'global',
      subjectId: 'entity-user',
      predicate: 'timezone',
      objectText: 'UTC+1',
    };

    expect(hasExactFactContentIdentity(identity, { ...identity, memoryOwnerId: 'owner-b' })).toBe(
      false,
    );
    expect(hasExactFactContentIdentity(identity, { ...identity })).toBe(true);
  });

  it('supersedes a prior fact when supersedePrior=true and stamps invalid_at', () => {
    const t0 = 1_000_000;
    const t1 = 2_000_000;
    const old = recordFact({
      subjectId: userId,
      predicate: 'lives_in',
      objectText: 'Cairo',
      scope: 'global',
      now: t0,
    });
    const fresh = recordFact({
      subjectId: userId,
      predicate: 'lives_in',
      objectText: 'Berlin',
      scope: 'global',
      supersedePrior: true,
      now: t1,
    });
    expect(fresh.superseded.map((f) => f.id)).toEqual([old.fact.id]);
    expect(getFactById(old.fact.id)?.invalidAt).toBe(t1);
    // currently-valid query returns only the new fact
    const live = listFacts({ subjectId: userId, predicate: 'lives_in' });
    expect(live).toHaveLength(1);
    expect(live[0].objectText).toBe('Berlin');
  });

  it('supersedes only the exact owner and scope identity across every scope', () => {
    const subjectId = 'entity-scope-isolation';
    const predicate = 'active_value';
    const record = (
      objectText: string,
      scope: 'global' | 'conversation' | 'project' | 'session',
      originConversationId?: string,
      originThreadId?: string,
      originTaskId?: string,
    ) =>
      recordFact({
        subjectId,
        predicate,
        objectText,
        scope,
        originConversationId,
        originThreadId,
        originTaskId,
        now: 100,
      }).fact;
    const recordPersona = (objectText: string, personaId: string) =>
      recordFactWithApplicability(
        { subjectId, predicate, objectText, scope: 'persona', now: 100 },
        { factClass: 'subjective_user', sourceAuthority: 'grounded_user', personaId },
      ).fact;

    const global = record('global-old', 'global');
    const foreignOwner = record('foreign-owner-old', 'global');
    getMemoryDb().runSync(
      "UPDATE memory_facts SET memory_owner_id = 'foreign-owner' WHERE id = ?",
      foreignOwner.id,
    );
    const personaA = recordPersona('persona-a-old', 'persona-a');
    const personaB = recordPersona('persona-b-old', 'persona-b');
    const conversationA = record('conversation-a-old', 'conversation', 'root-a');
    const conversationB = record('conversation-b-old', 'conversation', 'root-b');
    const projectA = record('project-a-old', 'project', 'root-a');
    const projectB = record('project-b-old', 'project', 'root-b');
    const sessionA = record('session-a-old', 'session', 'root-a', 'thread-a', 'task-a');
    const sessionB = record('session-b-old', 'session', 'root-a', 'thread-b', 'task-a');
    const malformedIds: string[] = [];
    const corrupt = (id: string, column: string, value: string | null) => {
      getMemoryDb().runSync(`UPDATE memory_facts SET ${column} = ? WHERE id = ?`, value, id);
      malformedIds.push(id);
    };
    for (const [column, value] of [
      ['persona_id', 'persona-a'],
      ['origin_conversation_id', 'root-a'],
      ['origin_thread_id', 'thread-a'],
      ['origin_task_id', 'task-a'],
    ] as const) {
      const fact = record(`malformed-global-${column}`, 'global');
      corrupt(fact.id, column, value);
    }
    for (const [column, value] of [
      ['origin_conversation_id', 'root-a'],
      ['origin_thread_id', 'thread-a'],
      ['origin_task_id', 'task-a'],
    ] as const) {
      const fact = recordPersona(`malformed-persona-${column}`, 'persona-a');
      corrupt(fact.id, column, value);
    }
    for (const scope of ['conversation', 'project'] as const) {
      for (const [column, value] of [
        ['persona_id', 'persona-a'],
        ['origin_task_id', 'task-a'],
        ['origin_thread_id', ' invalid-thread '],
      ] as const) {
        const fact = record(`malformed-${scope}-${column}`, scope, 'root-a');
        corrupt(fact.id, column, value);
      }
    }
    const malformedSessionPersona = record(
      'malformed-session-persona',
      'session',
      'root-a',
      'thread-a',
      'task-a',
    );
    corrupt(malformedSessionPersona.id, 'persona_id', 'persona-a');
    const malformedSessionTask = record(
      'malformed-session-task',
      'session',
      'root-a',
      'thread-a',
      'task-a',
    );
    corrupt(malformedSessionTask.id, 'origin_task_id', null);

    const globalReplacement = recordFact({
      subjectId,
      predicate,
      objectText: 'global-new',
      scope: 'global',
      supersedePrior: true,
      now: 200,
    });
    const personaReplacement = recordFactWithApplicability(
      {
        subjectId,
        predicate,
        objectText: 'persona-a-new',
        scope: 'persona',
        supersedePrior: true,
        now: 210,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user', personaId: 'persona-a' },
    );
    const conversationReplacement = recordFact({
      subjectId,
      predicate,
      objectText: 'conversation-a-new',
      scope: 'conversation',
      originConversationId: 'root-a',
      supersedePrior: true,
      now: 220,
    });
    const projectReplacement = recordFact({
      subjectId,
      predicate,
      objectText: 'project-a-new',
      scope: 'project',
      originConversationId: 'root-a',
      supersedePrior: true,
      now: 230,
    });
    const sessionReplacement = recordFact({
      subjectId,
      predicate,
      objectText: 'session-a-new',
      scope: 'session',
      originConversationId: 'root-a',
      originThreadId: 'thread-a',
      originTaskId: 'task-a',
      supersedePrior: true,
      now: 240,
    });

    expect(globalReplacement.superseded.map((fact) => fact.id)).toEqual([global.id]);
    expect(personaReplacement.superseded.map((fact) => fact.id)).toEqual([personaA.id]);
    expect(conversationReplacement.superseded.map((fact) => fact.id)).toEqual([conversationA.id]);
    expect(projectReplacement.superseded.map((fact) => fact.id)).toEqual([projectA.id]);
    expect(sessionReplacement.superseded.map((fact) => fact.id)).toEqual([sessionA.id]);

    const untouchedIds = [
      foreignOwner.id,
      personaB.id,
      conversationB.id,
      projectB.id,
      sessionB.id,
      ...malformedIds,
    ];
    const persisted = getMemoryDb().getAllSync<{ id: string; invalid_at: number | null }>(
      `SELECT id, invalid_at FROM memory_facts
        WHERE id IN (${untouchedIds.map(() => '?').join(', ')})
        ORDER BY id ASC`,
      ...untouchedIds,
    );
    expect(persisted).toHaveLength(untouchedIds.length);
    expect(persisted.every((row) => row.invalid_at === null)).toBe(true);
  });

  it('asOf time-travel returns the fact valid at a past timestamp', () => {
    const t0 = 1_000_000;
    const t1 = 2_000_000;
    const t2 = 3_000_000;
    recordFact({
      subjectId: userId,
      predicate: 'role',
      objectText: 'engineer',
      scope: 'global',
      now: t0,
    });
    recordFact({
      subjectId: userId,
      predicate: 'role',
      objectText: 'manager',
      scope: 'global',
      supersedePrior: true,
      now: t1,
    });
    const past = listFacts({ subjectId: userId, predicate: 'role', asOf: t0 + 100 });
    expect(past).toHaveLength(1);
    expect(past[0].objectText).toBe('engineer');
    const present = listFacts({ subjectId: userId, predicate: 'role', asOf: t2 });
    expect(present).toHaveLength(1);
    expect(present[0].objectText).toBe('manager');
  });

  it('rejects unsafe mutation clocks and invalid validity intervals', () => {
    expect(() =>
      recordFact({
        subjectId: userId,
        predicate: 'scope',
        objectText: 'bad',
        scope: 'invalid' as never,
        now: 100,
      }),
    ).toThrow('memory_fact_scope_invalid');
    expect(() =>
      recordFact({
        subjectId: userId,
        predicate: 'clock',
        objectText: 'bad',
        scope: 'global',
        now: 1.5,
      }),
    ).toThrow('memory_fact_mutation_clock_invalid');
    expect(() =>
      recordFact({
        subjectId: userId,
        predicate: 'validity',
        objectText: 'bad',
        scope: 'global',
        now: 100,
        validAt: 200,
        expiresAt: 200,
      }),
    ).toThrow('memory_fact_validity_order_invalid');
    expect(() =>
      recordFact({
        subjectId: userId,
        predicate: 'validity',
        objectText: 'bad',
        scope: 'global',
        now: 100,
        validAt: -1,
      }),
    ).toThrow('memory_fact_valid_at_invalid');

    const fact = recordFact({
      subjectId: userId,
      predicate: 'clock',
      objectText: 'safe',
      scope: 'global',
      now: 100,
    }).fact;
    expect(() => invalidateFact(fact.id, -1)).toThrow('memory_fact_mutation_clock_invalid');
    expect(() => setFactPinned(fact.id, true, Number.NaN)).toThrow(
      'memory_fact_mutation_clock_invalid',
    );
    expect(() =>
      setFactLocalSimilarity(
        fact.id,
        createCurrentLocalSimilarityVector('safe'),
        Number.POSITIVE_INFINITY,
      ),
    ).toThrow('memory_fact_mutation_clock_invalid');
    expect(() => markFactsRecalled([fact.id], Number.MAX_SAFE_INTEGER + 1)).toThrow(
      'memory_fact_mutation_clock_invalid',
    );
    expect(() =>
      replaceCurrentFact({
        expectedCurrentFactId: fact.id,
        subjectId: userId,
        predicate: 'clock',
        objectText: 'later',
        scope: 'global',
        now: -1,
      }),
    ).toThrow('memory_fact_mutation_clock_invalid');
  });

  it('invalidateFact stamps invalid_at and idempotents on second call', () => {
    const f = recordFact({
      subjectId: userId,
      predicate: 'p',
      objectText: 'o',
      scope: 'global',
    });
    expect(invalidateFact(f.fact.id)).toBe(true);
    expect(invalidateFact(f.fact.id)).toBe(false);
  });

  it('withdrawMemoryFact removes the row from current and historical reads', () => {
    const f = recordFact({
      subjectId: userId,
      predicate: 'p',
      objectText: 'o',
      scope: 'global',
    });
    expect(withdrawMemoryFact(f.fact.id).status).toBe('withdrawn');
    expect(listFacts({ subjectId: userId })).toHaveLength(0);
    expect(getFactById(f.fact.id)).toBeNull();
    expect(listFacts({ subjectId: userId, includeDeleted: true })).toHaveLength(0);
  });

  it('setFactPinned bubbles pinned facts to the top of listFacts', () => {
    const a = recordFact({
      subjectId: userId,
      predicate: 'a',
      objectText: '1',
      scope: 'global',
    });
    const b = recordFact({
      subjectId: userId,
      predicate: 'b',
      objectText: '2',
      scope: 'global',
    });
    setFactPinned(b.fact.id, true);
    const list = listFacts({ subjectId: userId });
    expect(list[0].id).toBe(b.fact.id);
    expect(list[1].id).toBe(a.fact.id);
    // pinnedOnly filter
    expect(listFacts({ subjectId: userId, pinnedOnly: true })).toHaveLength(1);
  });

  it('rejects empty subject/predicate/object', () => {
    expect(() =>
      recordFact({ subjectId: '', predicate: 'p', objectText: 'o', scope: 'global' }),
    ).toThrow();
    expect(() =>
      recordFact({ subjectId: userId, predicate: '', objectText: 'o', scope: 'global' }),
    ).toThrow();
    expect(() =>
      recordFact({ subjectId: userId, predicate: 'p', objectText: '', scope: 'global' }),
    ).toThrow();
  });

  it('records sourceMessageId / sourceRunId provenance', () => {
    const r = recordFact({
      subjectId: userId,
      predicate: 'said',
      objectText: 'hello',
      scope: 'global',
      sourceMessageId: 'm_42',
      sourceRunId: 'run_7',
    });
    expect(r.fact.sourceMessageId).toBe('m_42');
    expect(r.fact.sourceRunId).toBe('run_7');
  });

  it('maintains indexed retrieval terms for active facts', () => {
    const r = recordFact({
      subjectId: userId,
      predicate: 'route_code',
      objectText: 'QNEEDLE active memory',
      scope: 'global',
      memoryKind: 'semantic_fact',
    });
    const db = getMemoryDb();
    expect(
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_fact_terms
          WHERE fact_id = ? AND unit = ?`,
        r.fact.id,
        'qneedle',
      )?.count,
    ).toBe(1);

    expect(withdrawMemoryFact(r.fact.id).status).toBe('withdrawn');
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_terms WHERE fact_id = ?',
        r.fact.id,
      )?.count,
    ).toBe(0);
  });

  it('indexes short observed labels from long compact facts', () => {
    const longObservedTerms = Array.from(
      { length: 260 },
      (_, index) => `specificdescriptor${index.toString().padStart(3, '0')}`,
    ).join(' ');
    const r = recordFact({
      subjectId: userId,
      predicate: 'agent_observation',
      objectText: `${longObservedTerms} go qa panel`,
      scope: 'global',
      memoryKind: 'agent_run',
    });
    const db = getMemoryDb();
    const units = new Set(
      db
        .getAllSync<{
          unit: string;
        }>('SELECT unit FROM memory_fact_terms WHERE fact_id = ?', r.fact.id)
        .map((row) => row.unit),
    );

    expect(units.size).toBeLessThanOrEqual(384);
    expect(units.has('go')).toBe(true);
    expect(units.has('qa')).toBe(true);
    expect(units.has('panel')).toBe(true);
  });

  it('persists typed retrieval metadata for non-semantic memories', () => {
    const r = recordFact({
      subjectId: userId,
      predicate: 'agent_run',
      objectText: 'reports/analysis.json was created',
      scope: 'session',
      originConversationId: 'conversation-1',
      originThreadId: 'thread-1',
      originTaskId: 'task-1',
      memoryKind: 'agent_run',
      retrievability: 0.82,
      stability: 0.71,
      decayRate: 0.01,
      reviewState: 'verified',
      sensitivity: 'normal',
      sourceActorId: 'browser',
      now: 100,
    });

    const stored = getFactById(r.fact.id);
    expect(stored?.memoryKind).toBe('agent_run');
    expect(stored?.retrievability).toBe(0.82);
    expect(stored?.stability).toBe(0.71);
    expect(stored?.decayRate).toBe(0.01);
    expect(stored?.reviewState).toBe('verified');
    expect(stored?.sourceActorId).toBe('browser');
    expect(stored?.originTaskId).toBe('task-1');
    expect(countFacts({ memoryKind: 'agent_run' })).toBe(1);
  });

  it('does not dedupe distinct memory kinds into one row', () => {
    const semantic = recordFact({
      subjectId: userId,
      predicate: 'observed',
      objectText: 'reports/analysis.json was created',
      scope: 'global',
      memoryKind: 'semantic_fact',
    });
    const agentRun = recordFact({
      subjectId: userId,
      predicate: 'observed',
      objectText: 'reports/analysis.json was created',
      scope: 'global',
      memoryKind: 'agent_run',
    });

    expect(agentRun.status).toBe('created');
    expect(agentRun.fact.id).not.toBe(semantic.fact.id);
    expect(listFacts({ subjectId: userId, memoryKind: 'semantic_fact' })).toHaveLength(1);
    expect(listFacts({ subjectId: userId, memoryKind: 'agent_run' })).toHaveLength(1);
    expect(countFactsByKind()).toMatchObject({
      semantic_fact: 1,
      agent_run: 1,
    });
  });
});

describe('listFacts limit normalization', () => {
  beforeEach(() => {
    const userId = upsertEntity({ name: 'limit-test-user', type: 'self' }).id;
    for (let index = 0; index < 4; index += 1) {
      recordFact({
        subjectId: userId,
        predicate: `limit_${index}`,
        objectText: `value ${index}`,
        scope: 'global',
        supersedePrior: false,
      });
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'uses the default for non-finite limit %s',
    (limit) => {
      expect(listFacts({ limit })).toHaveLength(4);
    },
  );

  it.each([
    [0, 1],
    [-5, 1],
    [2.9, 2],
  ])('clamps finite limit %s to %s', (limit, expected) => {
    expect(listFacts({ limit })).toHaveLength(expected);
  });
});
