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
  recallScoredTestFacts as recallScoredFactsForQuery,
  recordRecallTestFact as recordFact,
} from '../../helpers/memoryRecallTestHarness';

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

describe('recallScoredFactsForQuery selector candidate diversity', () => {
  it('diversifies semantic selector candidates across structural sources', async () => {
    const project = upsertEntity({ name: 'epsilon release', type: 'project' });
    for (let index = 0; index < 8; index += 1) {
      recordFact({
        subjectId: project.id,
        predicate: 'observation',
        objectText: `shared alpha beta gamma repeated source evidence ${index}`,
        importance: 0.95,
        sourceRunId: 'source-a',
        supersedePrior: false,
      });
    }
    recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: 'shared alpha beta gamma source-b evidence',
      importance: 0.1,
      sourceRunId: 'source-b',
      supersedePrior: false,
    });
    const sourceC = recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: 'shared alpha beta gamma source-c evidence',
      importance: 0.1,
      sourceRunId: 'source-c',
      supersedePrior: false,
    });
    recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: 'shared alpha beta gamma source-d evidence',
      importance: 0.1,
      sourceRunId: 'source-d',
      supersedePrior: false,
    });
    let observedSourceRuns: string[] = [];

    const scored = await recallScoredFactsForQuery('shared alpha beta gamma', {
      limit: 1,
      selectorCandidateLimit: 4,
      selector: async ({ candidates }) => {
        observedSourceRuns = candidates.map((candidate) => candidate.fact.sourceRunId ?? '');
        return { factIds: [sourceC.fact.id] };
      },
    });

    expect(observedSourceRuns).toEqual(
      expect.arrayContaining(['source-a', 'source-b', 'source-c', 'source-d']),
    );
    expect(scored.map((entry) => entry.fact.id)).toEqual([sourceC.fact.id]);
  });

  it('admits semantic selections from distinct sources before repeated source variants', async () => {
    const project = upsertEntity({ name: 'zeta release', type: 'project' });
    const firstSourceA = recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: 'zeta shared evidence source a first',
      sourceRunId: 'source-a',
      importance: 0.9,
      now: 1,
    });
    const secondSourceA = recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: 'zeta shared evidence source a second',
      sourceRunId: 'source-a',
      importance: 0.8,
      supersedePrior: false,
      now: 2,
    });
    const sourceB = recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: 'zeta shared evidence source b complementary',
      sourceRunId: 'source-b',
      importance: 0.7,
      supersedePrior: false,
      now: 3,
    });

    const scored = await recallScoredFactsForQuery('zeta shared evidence', {
      limit: 2,
      selectorCandidateLimit: 6,
      selector: async () => ({
        factIds: [firstSourceA.fact.id, secondSourceA.fact.id, sourceB.fact.id],
      }),
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([firstSourceA.fact.id, sourceB.fact.id]);
  });
});
