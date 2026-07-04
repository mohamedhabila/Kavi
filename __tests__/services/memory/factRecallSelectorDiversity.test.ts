jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { recallScoredFactsForQuery } from '../../../src/services/memory/factRecall';

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
});
