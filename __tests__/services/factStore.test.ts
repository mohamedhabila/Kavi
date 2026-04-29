// ---------------------------------------------------------------------------
// Tests — Fact / Entity / Block Store (bi-temporal memory primitives)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
  upsertEntity,
  findEntityByName,
  getEntityById,
  softDeleteEntity,
  recordFact,
  listFacts,
  getFactById,
  invalidateFact,
  softDeleteFact,
  setFactPinned,
  ensureDefaultBlocks,
  getBlock,
  listBlocks,
  editBlock,
  upsertBlock,
  clearBlock,
  BlockOverflowError,
  DEFAULT_MEMORY_BLOCKS,
} from '../../src/services/memory/factStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

// ── Entity registry ─────────────────────────────────────────────────────

describe('upsertEntity', () => {
  it('creates a new entity with normalized name', () => {
    const e = upsertEntity({ name: '  Mohamed  ', type: 'person' });
    expect(e.canonicalName).toBe('mohamed');
    expect(e.type).toBe('person');
    expect(e.aliases).toEqual([]);
    expect(e.deletedAt).toBeNull();
  });

  it('returns existing entity on canonical match and rolls up aliases + attributes', () => {
    const a = upsertEntity({
      name: 'Acme Corp',
      type: 'org',
      aliases: ['acme'],
      attributes: { city: 'Seattle' },
    });
    const b = upsertEntity({
      name: 'Acme Corp',
      type: 'org',
      aliases: ['ACME inc'],
      attributes: { tier: 'gold' },
    });
    expect(b.id).toBe(a.id);
    expect(b.aliases).toEqual(expect.arrayContaining(['acme', 'acme inc']));
    expect(b.attributes).toMatchObject({ city: 'Seattle', tier: 'gold' });
  });

  it('finds an existing entity via alias match', () => {
    const created = upsertEntity({ name: 'OpenClaw', type: 'project', aliases: ['openclaw mobile'] });
    const looked = upsertEntity({ name: 'OpenClaw Mobile', type: 'project' });
    expect(looked.id).toBe(created.id);
  });

  it('throws on empty name', () => {
    expect(() => upsertEntity({ name: '   ', type: 'person' })).toThrow(/required/);
  });

  it('soft-deletes and is then invisible to default lookups', () => {
    const e = upsertEntity({ name: 'Bob', type: 'person' });
    expect(softDeleteEntity(e.id)).toBe(true);
    expect(findEntityByName('Bob', 'person')).toBeNull();
    // but findable by id
    expect(getEntityById(e.id)?.deletedAt).not.toBeNull();
  });
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

  it('softDeleteFact hides from default listFacts but is fetchable by id', () => {
    const f = recordFact({ subjectId: userId, predicate: 'p', objectText: 'o' });
    expect(softDeleteFact(f.fact.id)).toBe(true);
    expect(listFacts({ subjectId: userId })).toHaveLength(0);
    expect(getFactById(f.fact.id)?.deletedAt).not.toBeNull();
    expect(listFacts({ subjectId: userId, includeDeleted: true })).toHaveLength(1);
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
});

// ── Memory blocks ───────────────────────────────────────────────────────

describe('memory blocks', () => {
  it('ensureDefaultBlocks creates the catalog idempotently', () => {
    ensureDefaultBlocks();
    const labels = listBlocks().map((b) => b.label).sort();
    expect(labels).toEqual([...DEFAULT_MEMORY_BLOCKS.map((d) => d.label)].sort());
    // second call is a no-op (no duplicate rows)
    ensureDefaultBlocks();
    expect(listBlocks()).toHaveLength(DEFAULT_MEMORY_BLOCKS.length);
  });

  it('editBlock appends with a newline by default and respects char_limit', () => {
    ensureDefaultBlocks();
    const a = editBlock('active_focus', 'Drafting RFC');
    expect(a.content).toBe('Drafting RFC');
    const b = editBlock('active_focus', 'reviewed by Alice');
    expect(b.content).toBe('Drafting RFC\nreviewed by Alice');
  });

  it('editBlock with replace=true overwrites content', () => {
    ensureDefaultBlocks();
    editBlock('active_focus', 'old');
    const replaced = editBlock('active_focus', 'new', { replace: true });
    expect(replaced.content).toBe('new');
  });

  it('editBlock throws BlockOverflowError when exceeding char_limit', () => {
    ensureDefaultBlocks();
    const block = getBlock('active_focus')!;
    const oversized = 'x'.repeat(block.charLimit + 1);
    expect(() => editBlock('active_focus', oversized, { replace: true })).toThrow(
      BlockOverflowError,
    );
  });

  it('editBlock throws on unknown block label', () => {
    expect(() => editBlock('nonexistent', 'hi')).toThrow(/not found/);
  });

  it('upsertBlock creates a custom block then updates it', () => {
    upsertBlock({
      label: 'goals',
      content: 'ship single thread',
      charLimit: 200,
      description: 'top-of-mind goals',
      pinned: true,
      personaId: null,
    });
    expect(getBlock('goals')?.content).toBe('ship single thread');
    upsertBlock({
      label: 'goals',
      content: 'ship single thread + memory',
      charLimit: 200,
      description: 'top-of-mind goals',
      pinned: true,
      personaId: null,
    });
    expect(getBlock('goals')?.content).toBe('ship single thread + memory');
  });

  it('clearBlock empties the content but leaves the row', () => {
    ensureDefaultBlocks();
    editBlock('open_threads', 'follow up with Bob');
    expect(getBlock('open_threads')?.content).not.toBe('');
    expect(clearBlock('open_threads')).toBe(true);
    expect(getBlock('open_threads')?.content).toBe('');
  });

  it('listBlocks returns pinned blocks first', () => {
    ensureDefaultBlocks();
    const list = listBlocks();
    const pinnedFirst = list.findIndex((b) => !b.pinned);
    const lastPinned = [...list].reverse().findIndex((b) => b.pinned);
    expect(pinnedFirst).toBeGreaterThanOrEqual(0);
    // No unpinned block appears before any pinned block.
    const idxOfFirstUnpinned = list.findIndex((b) => !b.pinned);
    if (idxOfFirstUnpinned >= 0) {
      for (let i = idxOfFirstUnpinned; i < list.length; i++) {
        expect(list[i].pinned).toBe(false);
      }
    }
    expect(lastPinned).toBeGreaterThanOrEqual(0);
  });
});
