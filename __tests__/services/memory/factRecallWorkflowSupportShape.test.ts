jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recallFactsForQuery } from '../../../src/services/memory/factRecall';
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

describe('recallFactsForQuery — workflow support shape diversity', () => {
  it('deduplicates same-shape workflow support across volatile URLs', async () => {
    const corpus = upsertEntity({ name: 'support-shape-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'shape_primary',
      objectText: JSON.stringify({
        controlNames: ['qshapeanchor', 'qshapetarget'],
        url: 'https://example.test/flow/start',
        stateIndex: '1',
      }),
      sourceRunId: 'run-support-shape',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 1, url: 'https://example.test/flow/start' },
      now: 1_000,
    }).fact;
    const fillerA = recordFact({
      subjectId: corpus.id,
      predicate: 'shape_filler_a',
      objectText: 'qshapeanchor qfillera',
      now: 900,
    }).fact;
    const fillerB = recordFact({
      subjectId: corpus.id,
      predicate: 'shape_filler_b',
      objectText: 'qshapeanchor qfillerb',
      now: 800,
    }).fact;
    const fillerC = recordFact({
      subjectId: corpus.id,
      predicate: 'shape_filler_c',
      objectText: 'qshapeanchor qfillerc',
      now: 700,
    }).fact;
    const firstShape = recordFact({
      subjectId: corpus.id,
      predicate: 'shape_support_first',
      objectText: JSON.stringify({
        controlNames: ['qshapeanchor', 'qsame-shape'],
        url: 'https://example.test/flow/item/1',
        stateIndex: '2',
      }),
      sourceRunId: 'run-support-shape',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 2, url: 'https://example.test/flow/item/1' },
      now: 1_100,
    }).fact;
    const repeatedShape = recordFact({
      subjectId: corpus.id,
      predicate: 'shape_support_second',
      objectText: JSON.stringify({
        controlNames: ['qshapeanchor', 'qsame-shape'],
        url: 'https://example.test/flow/item/2',
        stateIndex: '3',
      }),
      sourceRunId: 'run-support-shape',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 3, url: 'https://example.test/flow/item/2' },
      now: 1_200,
    }).fact;
    const distinctShape = recordFact({
      subjectId: corpus.id,
      predicate: 'shape_support_distinct',
      objectText: JSON.stringify({
        controlNames: ['qshapeanchor', 'qdistinct-shape'],
        url: 'https://example.test/flow/summary',
        stateIndex: '4',
      }),
      sourceRunId: 'run-support-shape',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4, url: 'https://example.test/flow/summary' },
      now: 1_300,
    }).fact;

    const facts = await recallFactsForQuery(
      'qshapeanchor qshapetarget qfillera qfillerb qfillerc',
      {
        limit: 8,
        threshold: 0.01,
        candidatePoolLimit: 40,
        now: 2_000,
      },
    );
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds.slice(0, 4)).toEqual([target.id, fillerA.id, fillerB.id, fillerC.id]);
    expect(selectedIds).toContain(distinctShape.id);
    expect([firstShape.id, repeatedShape.id].filter((id) => selectedIds.includes(id))).toHaveLength(
      1,
    );
  });
});
