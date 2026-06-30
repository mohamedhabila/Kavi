// ---------------------------------------------------------------------------
// Tests - Query-time workflow support phase selection
// ---------------------------------------------------------------------------

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

describe('recallFactsForQuery - workflow support phase selection', () => {
  it('uses the most relevant support representative for repeated workflow surfaces', async () => {
    const corpus = upsertEntity({ name: 'support-phase-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_primary',
      objectText: JSON.stringify({
        controlNames: ['qphaseanchor', 'qphasetarget'],
        url: 'https://example.test/flow/surface',
        stateIndex: '10',
      }),
      sourceRunId: 'run-support-phase',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 10, url: 'https://example.test/flow/surface' },
      now: 1_000,
    }).fact;
    const fillerA = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_filler_a',
      objectText: 'qphaseanchor qfillera',
      sourceRunId: 'run-support-phase-filler-a',
      now: 900,
    }).fact;
    const fillerB = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_filler_b',
      objectText: 'qphaseanchor qfillerb',
      sourceRunId: 'run-support-phase-filler-b',
      now: 800,
    }).fact;
    const relevantSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_support_relevant',
      objectText: JSON.stringify({
        controlNames: ['qphaseanchor', 'qphasestale'],
        url: 'https://example.test/flow/surface',
        stateIndex: '11',
      }),
      sourceRunId: 'run-support-phase',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 11, url: 'https://example.test/flow/surface' },
      now: 2_000,
    }).fact;
    const latestSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_support_latest',
      objectText: JSON.stringify({
        controlNames: ['qphaselatest'],
        url: 'https://example.test/flow/surface',
        stateIndex: '12',
      }),
      sourceRunId: 'run-support-phase',
      memoryKind: 'ui_inventory',
      importance: 0.1,
      attributes: { stateIndex: 12, url: 'https://example.test/flow/surface' },
      now: 3_000,
    }).fact;

    const facts = await recallFactsForQuery('qphaseanchor qphasetarget', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds.slice(0, 3)).toEqual([target.id, fillerA.id, fillerB.id]);
    expect(selectedIds).toContain(relevantSupport.id);
    expect(selectedIds).not.toContain(latestSupport.id);
  });
});
