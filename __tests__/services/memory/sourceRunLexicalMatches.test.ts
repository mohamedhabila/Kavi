jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { listFactsForSourceRunLexicalMatches } from '../../../src/services/memory/facts/sourceRunLexicalMatches';
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

describe('listFactsForSourceRunLexicalMatches', () => {
  it('keeps a bounded evidence slice per source run', () => {
    const corpus = upsertEntity({ name: 'source-run-lexical-corpus', type: 'concept' });
    const targetRunId = 'run-target';
    const crowdedRunId = 'run-crowded';

    for (let index = 0; index < 4; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `crowded_${index}`,
        objectText: `qsourcea qsourceb qsourcec qsourcecrowded${index}`,
        sourceRunId: crowdedRunId,
        memoryKind: 'ui_inventory',
        attributes: { stateIndex: index },
        now: 2_000 + index,
      });
    }

    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target',
      objectText: 'qsourcea qsourceb qtargetevidence',
      sourceRunId: targetRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 5 },
      now: 1_000,
    });

    const matches = listFactsForSourceRunLexicalMatches(
      [crowdedRunId, targetRunId],
      ['qsourcea', 'qsourceb', 'qsourcec', 'qtargetevidence'],
      {
        limit: 2,
        factsPerSourceRun: 1,
      },
    );

    expect(matches.map((fact) => fact.sourceRunId)).toEqual(
      expect.arrayContaining([crowdedRunId, targetRunId]),
    );
    expect(matches.map((fact) => fact.id)).toContain(target.fact.id);
  });
});
