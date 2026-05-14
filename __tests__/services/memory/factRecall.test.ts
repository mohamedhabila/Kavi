// ---------------------------------------------------------------------------
// Tests — Query-time fact recall
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
  upsertEntity,
  recordFact,
  setFactPinned,
  getFactById,
  setFactEmbedding,
} from '../../../src/services/memory/factStore';
import {
  recallFactsForQuery,
  recallScoredFactsForQuery,
  embedFact,
  backfillFactEmbeddings,
} from '../../../src/services/memory/factRecall';
import * as embeddings from '../../../src/services/memory/embeddings';
import type { EmbeddingConfig } from '../../../src/types';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const FAKE_CONFIG: EmbeddingConfig = { provider: 'openai', model: 'text-embedding-3-small' };

let getEmbeddingCachedSpy: jest.SpyInstance;

function fakeEmbedding(seed: number, dim = 4): number[] {
  // Deterministic small unit-ish vectors keyed by `seed` so tests can assert
  // ordering without depending on a real embedder.
  const v = new Array(dim).fill(0).map((_, i) => Math.sin((seed + 1) * (i + 1)));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  getEmbeddingCachedSpy = jest.spyOn(embeddings, 'getEmbeddingCached');
  getEmbeddingCachedSpy.mockReset();
  getEmbeddingCachedSpy.mockReset();
});

afterEach(() => {
  getEmbeddingCachedSpy?.mockRestore();
});

describe('recallFactsForQuery — text-only (no embedding config)', () => {
  it('returns matching facts when query tokens overlap subject/predicate/value', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin' });
    recordFact({ subjectId: user.id, predicate: 'works_at', objectText: 'Acme' });

    const facts = await recallFactsForQuery('Where does the user live in Berlin?');

    expect(facts.map((f) => f.objectText)).toContain('Berlin');
    // Acme has no token overlap with the query, so it should not appear.
    expect(facts.map((f) => f.objectText)).not.toContain('Acme');
  });

  it('returns empty array when nothing matches and no pinned facts exist', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin' });

    const facts = await recallFactsForQuery('totally unrelated query xyzzy');

    expect(facts).toHaveLength(0);
  });

  it('respects the limit option', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    for (let i = 0; i < 5; i++) {
      recordFact({
        subjectId: user.id,
        predicate: `pref_${i}`,
        objectText: `coffee variant ${i}`,
      });
    }

    const facts = await recallFactsForQuery('coffee', { limit: 2 });

    expect(facts).toHaveLength(2);
  });
});

describe('recallFactsForQuery — pinned facts', () => {
  it('always includes pinned facts even when they would not otherwise match', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const pinnedResult = recordFact({
      subjectId: user.id,
      predicate: 'preferred_pronouns',
      objectText: 'they/them',
    });
    setFactPinned(pinnedResult.fact.id, true);

    const facts = await recallFactsForQuery('what is the weather today');

    expect(facts.map((f) => f.id)).toContain(pinnedResult.fact.id);
  });

  it('returns only pinned facts when query is empty', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const pinned = recordFact({
      subjectId: user.id,
      predicate: 'name',
      objectText: 'Alice',
    });
    setFactPinned(pinned.fact.id, true);
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin' });

    const facts = await recallFactsForQuery('   ');

    expect(facts).toHaveLength(1);
    expect(facts[0].id).toBe(pinned.fact.id);
  });

  it('returns empty when alwaysIncludePinned is false and query is empty', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const pinned = recordFact({
      subjectId: user.id,
      predicate: 'name',
      objectText: 'Alice',
    });
    setFactPinned(pinned.fact.id, true);

    const facts = await recallFactsForQuery('', { alwaysIncludePinned: false });

    expect(facts).toHaveLength(0);
  });
});

describe('recallFactsForQuery — vector path with embedding config', () => {
  it('uses cosine similarity when both query and facts are embedded', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const near = recordFact({
      subjectId: user.id,
      predicate: 'enjoys',
      objectText: 'jazz piano',
    });
    const far = recordFact({
      subjectId: user.id,
      predicate: 'enjoys',
      objectText: 'cycling',
    });

    // Embed each fact with a deterministic vector — `near` matches the query,
    // `far` is orthogonal.
    setFactEmbedding(near.fact.id, fakeEmbedding(1));
    setFactEmbedding(far.fact.id, fakeEmbedding(99));

    // Query embedding equals `near.fact` embedding ⇒ cosine == 1.
    getEmbeddingCachedSpy.mockResolvedValueOnce(fakeEmbedding(1));

    const facts = await recallFactsForQuery('something about music', {
      embeddingConfig: FAKE_CONFIG,
      threshold: 0.5,
    });

    expect(facts[0].id).toBe(near.fact.id);
    expect(facts.map((f) => f.id)).not.toContain(far.fact.id);
  });

  it('degrades to text-only scoring when embedder throws', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin' });

    getEmbeddingCachedSpy.mockRejectedValue(new Error('network down'));

    const facts = await recallFactsForQuery('Berlin trip planning', {
      embeddingConfig: FAKE_CONFIG,
    });

    // Still recovers Berlin fact via text overlap.
    expect(facts.map((f) => f.objectText)).toContain('Berlin');
  });

  it('skips vector scoring entirely when vectorWeight is 0', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin' });

    await recallFactsForQuery('Berlin', {
      embeddingConfig: FAKE_CONFIG,
      vectorWeight: 0,
    });

    expect(getEmbeddingCachedSpy).not.toHaveBeenCalled();
  });
});

describe('recallFactsForQuery — bi-temporal anchor', () => {
  it('honors the asOf option to recall facts that were valid at a past time', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const t0 = 1_000;
    const t1 = 2_000;
    const t2 = 3_000;

    recordFact({
      subjectId: user.id,
      predicate: 'works_at',
      objectText: 'Acme',
      now: t0,
    });
    // Supersedes Acme at t1.
    recordFact({
      subjectId: user.id,
      predicate: 'works_at',
      objectText: 'Globex',
      supersedePrior: true,
      now: t1,
    });

    const past = await recallFactsForQuery('works at', { asOf: t0 + 500 });
    const recent = await recallFactsForQuery('works at', { asOf: t2 });

    expect(past.map((f) => f.objectText)).toContain('Acme');
    expect(past.map((f) => f.objectText)).not.toContain('Globex');
    expect(recent.map((f) => f.objectText)).toContain('Globex');
    expect(recent.map((f) => f.objectText)).not.toContain('Acme');
  });
});

describe('embedFact / backfillFactEmbeddings', () => {
  it('persists an embedding for a fact', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const result = recordFact({
      subjectId: user.id,
      predicate: 'role',
      objectText: 'Engineer',
    });
    expect(result.fact.embedding).toBeNull();

    getEmbeddingCachedSpy.mockResolvedValue(fakeEmbedding(7));
    const stored = await embedFact(result.fact, FAKE_CONFIG);

    expect(stored).not.toBeNull();
    const refreshed = getFactById(result.fact.id);
    expect(refreshed?.embedding).toHaveLength(4);
  });

  it('returns null and does not touch the row when embedder fails', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const result = recordFact({
      subjectId: user.id,
      predicate: 'role',
      objectText: 'Engineer',
    });

    getEmbeddingCachedSpy.mockRejectedValue(new Error('boom'));
    const stored = await embedFact(result.fact, FAKE_CONFIG);

    expect(stored).toBeNull();
    expect(getFactById(result.fact.id)?.embedding).toBeNull();
  });

  it('backfills embeddings only for facts that lack one (capped by maxFacts)', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const a = recordFact({ subjectId: user.id, predicate: 'p1', objectText: 'v1' });
    const b = recordFact({ subjectId: user.id, predicate: 'p2', objectText: 'v2' });
    const c = recordFact({ subjectId: user.id, predicate: 'p3', objectText: 'v3' });
    setFactEmbedding(a.fact.id, fakeEmbedding(1));

    let calls = 0;
    getEmbeddingCachedSpy.mockImplementation(async () => {
      calls += 1;
      return fakeEmbedding(calls + 10);
    });

    const embedded = await backfillFactEmbeddings(FAKE_CONFIG, { maxFacts: 5 });

    // a was already embedded; b and c needed embedding.
    expect(embedded).toBe(2);
    expect(getFactById(b.fact.id)?.embedding).not.toBeNull();
    expect(getFactById(c.fact.id)?.embedding).not.toBeNull();
  });
});

describe('recallScoredFactsForQuery', () => {
  it('returns scoring breakdown alongside selected facts', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const fact = recordFact({
      subjectId: user.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
    });
    setFactPinned(fact.fact.id, true);

    const scored = await recallScoredFactsForQuery('user lives Berlin');

    expect(scored).toHaveLength(1);
    expect(scored[0].fact.id).toBe(fact.fact.id);
    expect(scored[0].pinnedBoost).toBeGreaterThan(0);
    expect(scored[0].textScore).toBeGreaterThan(0);
    // Combined score includes weighted text, confidence/decay, pinned,
    // importance, and reinforcement components.
    expect(scored[0].score).toBeGreaterThan(scored[0].pinnedBoost);
    expect(scored[0].importanceScore).toBeGreaterThan(0);
    expect(scored[0].decayMultiplier).toBeGreaterThan(0);
  });
});

describe('recallFactsForQuery — scoped decay and reinforcement', () => {
  it('boosts facts from the active conversation over similarly matching global facts', async () => {
    const user = upsertEntity({ name: 'project alpha', type: 'project' });
    const scoped = recordFact({
      subjectId: user.id,
      predicate: 'decision',
      objectText: 'Use the LiteRT backend for alpha',
      scope: 'conversation',
      originConversationId: 'conv-alpha',
      importance: 0.7,
      now: 10_000,
    });
    const global = recordFact({
      subjectId: user.id,
      predicate: 'decision',
      objectText: 'Use the remote backend for alpha',
      scope: 'global',
      importance: 0.7,
      now: 10_000,
    });

    const facts = await recallFactsForQuery('alpha backend decision', {
      conversationId: 'conv-alpha',
      now: 20_000,
      limit: 2,
    });

    expect(facts[0].id).toBe(scoped.fact.id);
    expect(facts.map((fact) => fact.id)).toContain(global.fact.id);
  });

  it('excludes facts from other conversations before scoring, even when pinned', async () => {
    const project = upsertEntity({ name: 'project beta', type: 'project' });
    const active = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'Use the local LiteRT backend for beta',
      scope: 'conversation',
      originConversationId: 'conv-active',
      importance: 0.4,
      now: 10_000,
    });
    const other = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'Use the remote cloud backend for beta',
      scope: 'conversation',
      originConversationId: 'conv-other',
      importance: 1,
      now: 20_000,
    });
    setFactPinned(other.fact.id, true);

    const facts = await recallFactsForQuery('beta backend decision', {
      conversationId: 'conv-active',
      now: 30_000,
      limit: 5,
    });

    expect(facts.map((fact) => fact.id)).toContain(active.fact.id);
    expect(facts.map((fact) => fact.id)).not.toContain(other.fact.id);
  });

  it('excludes session facts from other tasks before scoring', async () => {
    const task = upsertEntity({ name: 'release task', type: 'task' });
    const active = recordFact({
      subjectId: task.id,
      predicate: 'next_step',
      objectText: 'Run the Android release validation',
      scope: 'session',
      originTaskId: 'task-active',
      importance: 0.5,
    });
    const other = recordFact({
      subjectId: task.id,
      predicate: 'next_step',
      objectText: 'Skip validation and deploy directly',
      scope: 'session',
      originTaskId: 'task-other',
      importance: 1,
    });
    setFactPinned(other.fact.id, true);

    const facts = await recallFactsForQuery('release validation next step', {
      taskId: 'task-active',
      limit: 5,
    });

    expect(facts.map((fact) => fact.id)).toContain(active.fact.id);
    expect(facts.map((fact) => fact.id)).not.toContain(other.fact.id);
  });

  it('demotes stale low-importance facts behind recent important facts', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const now = 200 * 24 * 60 * 60 * 1000;
    const stale = recordFact({
      subjectId: user.id,
      predicate: 'prefers_editor',
      objectText: 'Vim for coding',
      importance: 0.1,
      decayPolicy: 'fast',
      now: 1,
    });
    const recent = recordFact({
      subjectId: user.id,
      predicate: 'prefers_editor',
      objectText: 'VS Code for coding',
      importance: 0.9,
      now: now - 1_000,
    });

    const facts = await recallFactsForQuery('coding editor preference', {
      now,
      limit: 2,
    });

    expect(facts[0].id).toBe(recent.fact.id);
    expect(facts.map((fact) => fact.id)[0]).not.toBe(stale.fact.id);
  });

  it('updates access counters for facts returned to the prompt', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const recorded = recordFact({
      subjectId: user.id,
      predicate: 'prefers_tone',
      objectText: 'concise implementation notes',
    });

    await recallFactsForQuery('concise implementation notes', { now: 123_000 });
    const refreshed = getFactById(recorded.fact.id);

    expect(refreshed?.accessCount).toBe(1);
    expect(refreshed?.lastRecalledAt).toBe(123_000);
  });
});
