// ---------------------------------------------------------------------------
// Tests - Query-time procedure representative selection
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { recallScoredFactsForQuery } from '../../../src/services/memory/factRecall';
import { insertProcedureLocalSupport } from '../../../src/services/memory/factRecallProcedureSupport';
import type { ScoredFact } from '../../../src/services/memory/factRecallTypes';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
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

function scored(fact: MemoryFact, score: number, relevanceScore = score): ScoredFact {
  return {
    fact,
    score,
    textScore: relevanceScore,
    lexicalScore: relevanceScore,
    relevanceScore,
    pinnedBoost: 0,
    decayMultiplier: 1,
    scopeBoost: 0,
    reinforcementBoost: 0,
    importanceScore: 0,
    retrievabilityScore: 1,
    quotedUiControlBoost: 0,
    surfaceLabelBoost: 0,
    surfaceIdentityScore: 0,
    visibleTextEvidenceBoost: 0,
  };
}

describe('recallFactsForQuery - procedure representatives', () => {
  it('uses same-source procedures as representatives for action-result workflow recalls', async () => {
    const corpus = upsertEntity({ name: 'action-result-procedure-representative', type: 'concept' });
    const actionResult = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qrepresentative qworkflow qstate',
      sourceRunId: 'run-action-procedure',
      memoryKind: 'outcome',
      attributes: { stateIndex: 2 },
      importance: 1,
      now: 2_000,
    }).fact;
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-action-procedure',
        steps: [
          { stateIndex: '2', action: 'qrepresentative qworkflow qstate' },
          { stateIndex: '5', action: 'qrepresentative qworkflow qdownstream' },
        ],
      }),
      sourceRunId: 'run-action-procedure',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;

    const scored = await recallScoredFactsForQuery('qrepresentative qworkflow qstate', {
      limit: 1,
      threshold: 0.01,
      candidatePoolLimit: 20,
      now: 3_000,
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([procedure.id]);
    expect(scored.map((entry) => entry.fact.id)).not.toContain(actionResult.id);
  });

  it('uses procedure representatives for terminal action-result workflow recalls', async () => {
    const corpus = upsertEntity({ name: 'terminal-procedure-representative', type: 'concept' });
    const actionResult = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qterminal qworkflow qstate',
      sourceRunId: 'run-terminal-procedure',
      memoryKind: 'outcome',
      attributes: { stateIndex: 4 },
      importance: 1,
      now: 2_000,
    }).fact;
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-terminal-procedure',
        steps: [
          { stateIndex: '1', action: 'qterminal qworkflow qstart' },
          { stateIndex: '4', action: 'qterminal qworkflow qstate' },
        ],
      }),
      sourceRunId: 'run-terminal-procedure',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;

    const scored = await recallScoredFactsForQuery('qterminal qworkflow qstate', {
      limit: 1,
      threshold: 0.01,
      candidatePoolLimit: 20,
      now: 3_000,
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([procedure.id]);
    expect(scored.map((entry) => entry.fact.id)).not.toContain(actionResult.id);
  });

  it('adds procedure support for the strongest selected action-result source', () => {
    const corpus = upsertEntity({ name: 'ranked-action-procedure-support', type: 'concept' });
    const selectedProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-selected-procedure',
        steps: [
          { stateIndex: '1', action: 'qselected qprocedure' },
          { stateIndex: '2', action: 'qselected qdone' },
        ],
      }),
      sourceRunId: 'run-selected-procedure',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const weakOutcome = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qshared qweak outcome',
      sourceRunId: 'run-weak-action',
      memoryKind: 'outcome',
      attributes: { stateIndex: 2 },
      now: 2_000,
    }).fact;
    const weakProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-weak-action',
        steps: [
          { stateIndex: '2', action: 'qshared qweak' },
          { stateIndex: '3', action: 'qshared qweak done' },
        ],
      }),
      sourceRunId: 'run-weak-action',
      memoryKind: 'procedure',
      now: 2_100,
    }).fact;
    const strongOutcome = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qshared qstrong outcome',
      sourceRunId: 'run-strong-action',
      memoryKind: 'outcome',
      attributes: { stateIndex: 2 },
      now: 3_000,
    }).fact;
    const strongProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-strong-action',
        steps: [
          { stateIndex: '2', action: 'qshared qstrong' },
          { stateIndex: '3', action: 'qshared qstrong done' },
        ],
      }),
      sourceRunId: 'run-strong-action',
      memoryKind: 'procedure',
      now: 3_100,
    }).fact;
    const overflowOutcome = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qshared qoverflow outcome',
      sourceRunId: 'run-overflow',
      memoryKind: 'outcome',
      attributes: { stateIndex: 2 },
      now: 4_000,
    }).fact;
    const selected = [selectedProcedure, weakOutcome, strongOutcome, overflowOutcome];
    const scoredById = new Map([
      [selectedProcedure.id, scored(selectedProcedure, 0.7)],
      [weakOutcome.id, scored(weakOutcome, 0.4)],
      [strongOutcome.id, scored(strongOutcome, 0.9)],
      [overflowOutcome.id, scored(overflowOutcome, 0.3)],
    ]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: Array.from(scoredById.values()),
      limit: 4,
      uiSupportBudget: 0,
      procedureSupportBudget: 1,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qshared', 'qstrong']),
      recallLexicalUnits: ['qshared', 'qstrong'],
      unitWeights: new Map([
        ['qshared', 1],
        ['qstrong', 1],
      ]),
      query: 'qshared qstrong',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 5_000,
    });

    expect(selected.map((fact) => fact.id)).toContain(strongProcedure.id);
    expect(selected.map((fact) => fact.id)).not.toContain(weakProcedure.id);
    expect(selected).toHaveLength(4);
  });

});
