jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  recordFactWithApplicability,
  setFactPinned,
} from '../../../src/services/memory/facts/mutations';
import { recallScoredFactsForQuery as recallScoredFactsForQueryImpl } from '../../../src/services/memory/factRecall';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import type { RecordFactInput } from '../../../src/services/memory/facts/types';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

function recordFact(input: Omit<RecordFactInput, 'scope'>) {
  return recordFactWithApplicability(
    { ...input, scope: 'global' },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
}

function recallScoredFactsForQuery(query: string, options: { now: number }) {
  return recallScoredFactsForQueryImpl(query, {
    ...options,
    memoryScope: resolveLocalMemoryAccessScope({
      memoryConversationId: 'fact-recall-decay-root',
      sourceThreadId: 'fact-recall-decay-root',
      personaId: 'default',
      taskId: null,
    }),
    useIntent: 'automatic_prompt',
  });
}

describe('recallFactsForQuery — temporal decay math', () => {
  it('gives fresh facts a decay multiplier near 1.0', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin', now: 1_000_000 });

    const scored = await recallScoredFactsForQuery('Berlin', { now: 1_000_000 + 60_000 });
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].decayMultiplier).toBeGreaterThan(0.99);
  });

  it('gives old facts a lower decay multiplier', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin', now: 1_000_000 });

    // 60 days later — with default half-life (~30-120 days), decay should be noticeable
    const scored = await recallScoredFactsForQuery('Berlin', {
      now: 1_000_000 + 60 * 24 * 60 * 60 * 1000,
    });
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].decayMultiplier).toBeLessThan(0.9);
  });

  it('gives pinned facts no decay (multiplier stays 1.0)', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const fact = recordFact({
      subjectId: user.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
      now: 1_000_000,
    });
    setFactPinned(fact.fact.id, true);

    const scored = await recallScoredFactsForQuery('Berlin', {
      now: 1_000_000 + 365 * 24 * 60 * 60 * 1000,
    });
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].decayMultiplier).toBe(1);
  });

  it('applies faster decay for fast decay policy', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({
      subjectId: user.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
      decayPolicy: 'fast',
      now: 1_000_000,
    });
    recordFact({
      subjectId: user.id,
      predicate: 'works_on',
      objectText: 'Kavi',
      decayPolicy: 'normal',
      now: 1_000_000,
    });

    // 14 days later — fast half-life is ~7 days, normal is ~30+ days
    const now = 1_000_000 + 14 * 24 * 60 * 60 * 1000;
    const scored = await recallScoredFactsForQuery('Berlin Kavi', { now });
    const fastEntry = scored.find((s) => s.fact.predicate === 'lives_in');
    const normalEntry = scored.find((s) => s.fact.predicate === 'works_on');
    expect(fastEntry).toBeDefined();
    expect(normalEntry).toBeDefined();
    expect(fastEntry!.decayMultiplier).toBeLessThan(normalEntry!.decayMultiplier);
  });
});
