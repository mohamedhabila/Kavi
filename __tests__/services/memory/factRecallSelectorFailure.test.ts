jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import {
  recallScoredFactsForQuery,
  type RecallFactsTiming,
} from '../../../src/services/memory/factRecall';
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
});

describe('semantic fact selector failure', () => {
  it('preserves deterministic evidence and reports a closed fallback timing', async () => {
    const project = upsertEntity({ name: 'resilient release', type: 'project' });
    const expected = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'resilient release uses deterministic evidence after selector failure',
      importance: 0.9,
    });
    let observedTiming: RecallFactsTiming | undefined;

    const scored = await recallScoredFactsForQuery('resilient release deterministic evidence', {
      limit: 1,
      selector: async () => {
        throw new Error('private provider failure');
      },
      onTiming: (timing) => {
        observedTiming = timing;
      },
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([expected.fact.id]);
    expect(observedTiming).toMatchObject({
      selectorApplied: false,
      selectorSelectedCount: 0,
    });
  });
});
