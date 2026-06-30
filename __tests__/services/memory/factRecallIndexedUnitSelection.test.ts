jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recallScoredFactsForQuery } from '../../../src/services/memory/factRecall';
import { recordFact } from '../../../src/services/memory/facts/mutations';
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

describe('recallFactsForQuery - indexed unit selection', () => {
  it('does not let absent query units crowd out a rare indexed memory', async () => {
    const corpus = upsertEntity({ name: 'indexed-unit-selection-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target',
      objectText: 'qrarecandidate qactioncontext qanswercontext',
      sourceRunId: 'run-target',
      now: 1_000,
    });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `common_${index}`,
        objectText: `qsharedcandidate qcommoncandidate qnoise${index}`,
        sourceRunId: `run-common-${index}`,
        now: 2_000 + index,
      });
    }

    const absentUnits = Array.from({ length: 36 }, (_, index) => `qabsentcandidate${index}`);
    const scored = await recallScoredFactsForQuery(
      `${absentUnits.join(' ')} qrarecandidate qsharedcandidate`,
      {
        limit: 1,
        threshold: 0,
        candidatePoolLimit: 40,
      },
    );

    expect(scored.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(scored[0].textScore).toBeGreaterThan(0);
  });
});
