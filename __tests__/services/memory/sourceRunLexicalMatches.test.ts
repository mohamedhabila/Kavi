jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  listFactsForSourceRunLexicalMatches,
  listSourceRunIdsForLexicalEvidence,
} from '../../../src/services/memory/facts/sourceRunLexicalMatches';
import { SOURCE_RUN_CANDIDATE_EXPANSION_KINDS } from '../../../src/services/memory/factRecallSourceExpansion';
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

  it('includes procedure traces in source-local expansion candidates', () => {
    const corpus = upsertEntity({ name: 'source-run-procedure-expansion-corpus', type: 'concept' });
    const sourceRunId = 'run-source-procedure-expansion';
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        goal: 'qworkflowgoal',
        steps: [
          {
            stateIndex: '2',
            action: 'tap qworkflowtarget',
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      now: 2_000,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '2',
        controlName: 'qworkflowtarget',
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 2 },
      now: 1_000,
    });

    const matches = listFactsForSourceRunLexicalMatches([sourceRunId], ['qworkflowtarget'], {
      memoryKind: SOURCE_RUN_CANDIDATE_EXPANSION_KINDS,
      factsPerSourceRun: 2,
    });

    expect(matches.map((fact) => fact.id)).toContain(procedure.id);
  });

  it('retains a matching procedure representative beside stronger source fragments', () => {
    const corpus = upsertEntity({
      name: 'source-run-procedure-representative-corpus',
      type: 'concept',
    });
    const sourceRunId = 'run-source-procedure-representative';
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        steps: [{ stateIndex: '1', action: 'tap qworkflowtarget' }],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      attributes: { stateIndex: 1 },
      now: 1_000,
    }).fact;

    for (let index = 0; index < 4; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `outcome_${index}`,
        objectText: `qworkflowtarget qworkflowextra qfragment${index}`,
        sourceRunId,
        memoryKind: 'outcome',
        attributes: { stateIndex: index + 2 },
        now: 2_000 + index,
      });
    }

    const matches = listFactsForSourceRunLexicalMatches(
      [sourceRunId],
      ['qworkflowtarget', 'qworkflowextra'],
      {
        memoryKind: SOURCE_RUN_CANDIDATE_EXPANSION_KINDS,
        factsPerSourceRun: 2,
      },
    );

    expect(matches.map((fact) => fact.id)).toContain(procedure.id);
  });

  it('selects source runs by strongest matching fact instead of run length', () => {
    const corpus = upsertEntity({ name: 'source-run-strongest-fact-corpus', type: 'concept' });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `crowded_${index}`,
        objectText: `qsourcecommon qsourcecrowd${index}`,
        sourceRunId: 'run-crowded-source',
        memoryKind: 'ui_field',
        now: 3_000 + index,
      });
    }
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_outcome',
      objectText: 'qsourcecommon qsourcetargeta qsourcetargetb qsourcetargetc',
      sourceRunId: 'run-target-source',
      memoryKind: 'outcome',
      now: 1_000,
    });

    const sourceRunIds = listSourceRunIdsForLexicalEvidence(
      ['qsourcecommon', 'qsourcetargeta', 'qsourcetargetb', 'qsourcetargetc'],
      { limit: 1 },
    );

    expect(sourceRunIds).toEqual(['run-target-source']);
  });

  it('keeps source runs with distributed workflow evidence', () => {
    const corpus = upsertEntity({
      name: 'source-run-distributed-evidence-corpus',
      type: 'concept',
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'single_fragment',
      objectText: 'qworkflowa qworkflowb qworkflowc qworkflowd',
      sourceRunId: 'run-single-fragment',
      memoryKind: 'outcome',
      now: 1_000,
    });

    for (let index = 0; index < 8; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `distributed_${index}`,
        objectText: `qworkflowa qworkflowb qworkflowdistributed${index}`,
        sourceRunId: 'run-distributed-workflow',
        memoryKind: index % 2 === 0 ? 'outcome' : 'ui_inventory',
        now: 2_000 + index,
      });
    }

    const sourceRunIds = listSourceRunIdsForLexicalEvidence(
      ['qworkflowa', 'qworkflowb', 'qworkflowc', 'qworkflowd'],
      { limit: 2 },
    );

    expect(sourceRunIds).toContain('run-distributed-workflow');
    expect(sourceRunIds).toContain('run-single-fragment');
  });
});
