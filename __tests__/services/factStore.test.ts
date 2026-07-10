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
  recordFact,
  setFactPinned,
} from '../../src/services/memory/facts/mutations';
import { withdrawMemoryFact } from '../../src/services/memory/withdrawal';
import {
  countFacts,
  countFactsByKind,
  getFactById,
  listFacts,
} from '../../src/services/memory/facts/queries';

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
      now: t0,
    });
    expect(result.status).toBe('created');
    expect(result.fact.validAt).toBe(t0);
    expect(result.fact.invalidAt).toBeNull();
    expect(result.superseded).toEqual([]);
  });

  it('dedupes identical content_hash without creating a duplicate row', () => {
    const a = recordFact({ subjectId: userId, predicate: 'works_at', objectText: 'Acme' });
    const b = recordFact({ subjectId: userId, predicate: 'works_at', objectText: 'Acme' });
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
      originConversationId: 'global-origin-a',
      originThreadId: 'global-thread-a',
      originTaskId: 'global-task-a',
    });
    const globalReplay = recordFact({
      subjectId: userId,
      predicate: 'timezone',
      objectText: 'UTC+1',
      scope: 'global',
      originConversationId: 'global-origin-b',
      originThreadId: 'global-thread-b',
      originTaskId: 'global-task-b',
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
      originTaskId: 'task-a',
    });
    const conversationReplay = recordFact({
      subjectId: userId,
      predicate: 'display_name',
      objectText: 'Mo',
      scope: 'conversation',
      originConversationId: 'conversation-a',
      originThreadId: 'thread-b',
      originTaskId: 'task-b',
    });
    expect(conversationReplay.status).toBe('duplicate');
    expect(conversationReplay.fact.id).toBe(conversation.fact.id);

    const canonicalText = recordFact({
      subjectId: userId,
      predicate: 'favorite_cafe',
      objectText: 'Cafe\u0301',
    });
    const canonicalTextReplay = recordFact({
      subjectId: userId,
      predicate: 'favorite_cafe',
      objectText: 'Caf\u00e9',
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
      originTaskId: 'task-a',
    });
    const projectB = recordFact({
      subjectId: userId,
      predicate: 'release',
      objectText: 'v1',
      scope: 'project',
      originConversationId: 'conversation-a',
      originThreadId: 'thread-b',
      originTaskId: 'task-b',
    });
    expect(projectB.status).toBe('created');
    expect(projectB.fact.id).not.toBe(projectA.fact.id);
  });

  it('supersedes a prior fact when supersedePrior=true and stamps invalid_at', () => {
    const t0 = 1_000_000;
    const t1 = 2_000_000;
    const old = recordFact({
      subjectId: userId,
      predicate: 'lives_in',
      objectText: 'Cairo',
      now: t0,
    });
    const fresh = recordFact({
      subjectId: userId,
      predicate: 'lives_in',
      objectText: 'Berlin',
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

  it('asOf time-travel returns the fact valid at a past timestamp', () => {
    const t0 = 1_000_000;
    const t1 = 2_000_000;
    const t2 = 3_000_000;
    recordFact({ subjectId: userId, predicate: 'role', objectText: 'engineer', now: t0 });
    recordFact({
      subjectId: userId,
      predicate: 'role',
      objectText: 'manager',
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

  it('invalidateFact stamps invalid_at and idempotents on second call', () => {
    const f = recordFact({ subjectId: userId, predicate: 'p', objectText: 'o' });
    expect(invalidateFact(f.fact.id)).toBe(true);
    expect(invalidateFact(f.fact.id)).toBe(false);
  });

  it('withdrawMemoryFact removes the row from current and historical reads', () => {
    const f = recordFact({ subjectId: userId, predicate: 'p', objectText: 'o' });
    expect(withdrawMemoryFact(f.fact.id).status).toBe('withdrawn');
    expect(listFacts({ subjectId: userId })).toHaveLength(0);
    expect(getFactById(f.fact.id)).toBeNull();
    expect(listFacts({ subjectId: userId, includeDeleted: true })).toHaveLength(0);
  });

  it('setFactPinned bubbles pinned facts to the top of listFacts', () => {
    const a = recordFact({ subjectId: userId, predicate: 'a', objectText: '1' });
    const b = recordFact({ subjectId: userId, predicate: 'b', objectText: '2' });
    setFactPinned(b.fact.id, true);
    const list = listFacts({ subjectId: userId });
    expect(list[0].id).toBe(b.fact.id);
    expect(list[1].id).toBe(a.fact.id);
    // pinnedOnly filter
    expect(listFacts({ subjectId: userId, pinnedOnly: true })).toHaveLength(1);
  });

  it('rejects empty subject/predicate/object', () => {
    expect(() => recordFact({ subjectId: '', predicate: 'p', objectText: 'o' })).toThrow();
    expect(() => recordFact({ subjectId: userId, predicate: '', objectText: 'o' })).toThrow();
    expect(() => recordFact({ subjectId: userId, predicate: 'p', objectText: '' })).toThrow();
  });

  it('records sourceMessageId / sourceRunId provenance', () => {
    const r = recordFact({
      subjectId: userId,
      predicate: 'said',
      objectText: 'hello',
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
      memoryKind: 'agent_run',
      retrievability: 0.82,
      stability: 0.71,
      decayRate: 0.01,
      reviewState: 'verified',
      sensitivity: 'normal',
      sourceActorId: 'browser',
      taskId: 'task-1',
      now: 100,
    });

    const stored = getFactById(r.fact.id);
    expect(stored?.memoryKind).toBe('agent_run');
    expect(stored?.retrievability).toBe(0.82);
    expect(stored?.stability).toBe(0.71);
    expect(stored?.decayRate).toBe(0.01);
    expect(stored?.reviewState).toBe('verified');
    expect(stored?.sourceActorId).toBe('browser');
    expect(stored?.taskId).toBe('task-1');
    expect(countFacts({ memoryKind: 'agent_run' })).toBe(1);
  });

  it('does not dedupe distinct memory kinds into one row', () => {
    const semantic = recordFact({
      subjectId: userId,
      predicate: 'observed',
      objectText: 'reports/analysis.json was created',
      memoryKind: 'semantic_fact',
    });
    const agentRun = recordFact({
      subjectId: userId,
      predicate: 'observed',
      objectText: 'reports/analysis.json was created',
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
