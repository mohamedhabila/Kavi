// ---------------------------------------------------------------------------
// Tests — Query-time fact recall ranking
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  recallFactsForQuery,
  recallScoredFactsForQuery,
} from '../../../src/services/memory/factRecall';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('recallFactsForQuery — ranking', () => {
  it('weights rare query units above high-frequency overlap', async () => {
    const corpus = upsertEntity({ name: 'idf-corpus', type: 'concept' });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `generic_${index}`,
        objectText: `qcommonone qcommontwo qcommonthree distractor${index}`,
      });
    }
    const relevant = recordFact({
      subjectId: corpus.id,
      predicate: 'target',
      objectText: 'qcommonone qraretoken',
    });

    const scored = await recallScoredFactsForQuery(
      'qcommonone qcommontwo qcommonthree qraretoken',
      {
        limit: 3,
        vectorWeight: 0,
        textWeight: 1,
        threshold: 0.01,
        candidatePoolLimit: 50,
      },
    );

    expect(scored[0].fact.id).toBe(relevant.fact.id);
    expect(scored[0].textScore).toBeGreaterThan(scored[1].textScore);
  });

  it('keeps relevant trajectory neighbors with a retrieved source-run fact', async () => {
    const corpus = upsertEntity({ name: 'trajectory-corpus', type: 'concept' });
    for (let index = 0; index < 8; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `other_${index}`,
        objectText: `qanchor qshared qnoise${index}`,
        sourceRunId: `run-other-${index}`,
        attributes: { stateIndex: index },
        now: 1_000 + index,
      });
    }
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_anchor',
      objectText: 'qanchor qshared qtarget',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 5 },
      now: 3_000,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_setup',
      objectText: 'qshared qtarget-setup',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 0 },
      now: 1_999,
    });
    const prior = recordFact({
      subjectId: corpus.id,
      predicate: 'target_prior',
      objectText: 'qshared qtarget-prior',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 1 },
      now: 2_000,
    });
    const nearPrior = recordFact({
      subjectId: corpus.id,
      predicate: 'target_near_prior',
      objectText: 'qanchor qshared qtarget-near-prior',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 4 },
      now: 2_999,
    });
    const next = recordFact({
      subjectId: corpus.id,
      predicate: 'target_next',
      objectText: 'qshared qtarget-next',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 6 },
      now: 3_001,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_next_duplicate',
      objectText: 'qshared qtarget-next-duplicate',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 6 },
      now: 3_002,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_result',
      objectText: 'qshared qtarget-result',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 7 },
      now: 3_003,
    });

    const facts = await recallFactsForQuery('qanchor qshared', {
      limit: 5,
      vectorWeight: 0,
      textWeight: 1,
      threshold: 0.01,
      candidatePoolLimit: 50,
      now: 4_000,
    });

    expect(next.fact.attributes.stateIndex).toBe(6);
    expect(facts[0].attributes.stateIndex).toBe(5);
    expect(facts.map((fact) => fact.id)).toContain(prior.fact.id);
    expect(facts.map((fact) => fact.id)).not.toContain(nearPrior.fact.id);
    expect(facts.some((fact) => Number(fact.attributes.stateIndex) > 5)).toBe(true);
    expect(facts.map((fact) => Number(fact.attributes.stateIndex))).toEqual([5, 6, 7, 0, 1]);
  });
});
