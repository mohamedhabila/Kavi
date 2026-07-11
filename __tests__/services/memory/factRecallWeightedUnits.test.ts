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

describe('recallScoredFactsForQuery — weighted query unit coverage', () => {
  it('keeps lower-weight matched query units available as combined evidence', async () => {
    const project = upsertEntity({ name: 'weighted recall project', type: 'project' });
    const sharedUnit = 'anchorunit';
    const commonUnits = Array.from({ length: 10 }, (_, index) => `commonunit${index}`);
    const rareUnits = Array.from({ length: 10 }, (_, index) => `rareunit${index}`);
    const target = recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: [sharedUnit, ...commonUnits, 'targetvalue'].join(' '),
      importance: 0.7,
      now: 1,
    });

    for (let index = 0; index < rareUnits.length; index += 1) {
      recordFact({
        subjectId: project.id,
        predicate: `rare_distractor_${index}`,
        objectText: `${sharedUnit} ${rareUnits[index]}`,
        importance: 0.9,
        supersedePrior: false,
        now: 10_000 + index,
      });
    }
    for (let index = 0; index < 24; index += 1) {
      recordFact({
        subjectId: project.id,
        predicate: `common_context_${index}`,
        objectText: [...commonUnits, `contextunit${index}`].join(' '),
        importance: 0.4,
        supersedePrior: false,
        now: 20_000 + index,
      });
    }

    const scored = await recallScoredFactsForQuery(
      [sharedUnit, ...commonUnits, ...rareUnits].join(' '),
      {
        limit: 1,
        now: 30_000,
      },
    );

    expect(scored).toHaveLength(1);
    expect(scored[0].fact.id).toBe(target.fact.id);
  });
});
