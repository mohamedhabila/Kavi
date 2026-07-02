// ---------------------------------------------------------------------------
// Tests - Procedure endpoint UI support
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recallFactsForQuery } from '../../../src/services/memory/factRecall';
import { insertProcedureLocalSupport } from '../../../src/services/memory/factRecallProcedureSupport';
import type { ScoredFact } from '../../../src/services/memory/factRecallTypes';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
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

describe('procedure endpoint and budget UI support', () => {
  it('balances local UI support across selected procedure sources', () => {
    const corpus = upsertEntity({ name: 'procedure-source-balanced-support', type: 'concept' });
    const firstProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-balanced-first',
        steps: [
          { stateIndex: '1', action: 'click qfirst-action' },
          { stateIndex: '2', action: 'click qfirst-extra-action' },
        ],
      }),
      sourceRunId: 'run-procedure-balanced-first',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const secondProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-balanced-second',
        steps: [{ stateIndex: '1', action: 'click qsecond-action' }],
      }),
      sourceRunId: 'run-procedure-balanced-second',
      memoryKind: 'procedure',
      now: 1_100,
    }).fact;
    const firstSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-balanced-first',
        stateIndex: '1',
        controlNames: ['qtarget qfirst'],
      }),
      sourceRunId: 'run-procedure-balanced-first',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 1 },
      now: 1_200,
    }).fact;
    const secondSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-balanced-second',
        stateIndex: '1',
        controlNames: ['qtarget qsecond'],
      }),
      sourceRunId: 'run-procedure-balanced-second',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 1 },
      now: 1_300,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-balanced-first',
        stateIndex: '2',
        controlNames: ['qtarget qfirst-extra'],
      }),
      sourceRunId: 'run-procedure-balanced-first',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 2 },
      retrievability: 1,
      now: 1_400,
    });
    const selected = [firstProcedure, secondProcedure];
    const scoredById = new Map([
      [firstProcedure.id, scored(firstProcedure, 1)],
      [secondProcedure.id, scored(secondProcedure, 1)],
    ]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: Array.from(scoredById.values()),
      limit: 4,
      uiSupportBudget: 2,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qtarget']),
      recallLexicalUnits: ['qtarget'],
      unitWeights: new Map([['qtarget', 1]]),
      query: 'qtarget',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([
      firstProcedure.id,
      firstSupport.id,
      secondProcedure.id,
      secondSupport.id,
    ]);
  });

  it('anchors procedure UI support to the latest endpoint in repeated attempts', () => {
    const corpus = upsertEntity({ name: 'procedure-endpoint-ui-support', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-endpoint-support',
        actionTransitions: [
          { fromStateIndex: '20', toStateIndex: '21', observedAction: 'click qearly-action' },
          { fromStateIndex: '49', toStateIndex: '50', observedAction: 'click qfinal-action' },
        ],
        steps: [
          { stateIndex: '0', action: 'click qstart' },
          { stateIndex: '20', action: 'click qearly-action' },
          { stateIndex: '49', action: 'click qfinal-action' },
        ],
      }),
      sourceRunId: 'run-procedure-endpoint-support',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const earlyUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-endpoint-support',
        stateIndex: '21',
        controlNames: ['qtarget qearly qrich'],
        fields: [
          { role: 'textbox', controlName: 'qtarget qearly-field' },
          { role: 'combobox', controlName: 'qtarget qearly-combo', options: ['qa', 'qb'] },
        ],
      }),
      sourceRunId: 'run-procedure-endpoint-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 21 },
      now: 1_300,
    }).fact;
    const endpointUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-endpoint-support',
        stateIndex: '50',
        controlNames: ['qtarget qfinal'],
      }),
      sourceRunId: 'run-procedure-endpoint-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 50 },
      now: 1_100,
    }).fact;
    const selected = [procedure];
    const scoredById = new Map([[procedure.id, scored(procedure, 1)]]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: [scored(procedure, 1), scored(earlyUi, 10)],
      limit: 2,
      uiSupportBudget: 1,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qtarget']),
      recallLexicalUnits: ['qtarget'],
      unitWeights: new Map([['qtarget', 1]]),
      query: 'qtarget',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([procedure.id, endpointUi.id]);
  });

  it('adds endpoint support when another same-run UI state is already selected', () => {
    const corpus = upsertEntity({
      name: 'procedure-endpoint-selected-ui-support',
      type: 'concept',
    });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-selected-ui-support',
        steps: [
          { stateIndex: '21', action: 'click qearly-action' },
          { stateIndex: '49', action: 'click qfinal-action' },
          { stateIndex: '50', action: 'observe qfinal-state' },
        ],
      }),
      sourceRunId: 'run-procedure-selected-ui-support',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const selectedUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-selected-ui-support',
        stateIndex: '21',
        controlNames: ['qtarget qearly'],
      }),
      sourceRunId: 'run-procedure-selected-ui-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 21 },
      now: 1_100,
    }).fact;
    const endpointUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-selected-ui-support',
        stateIndex: '50',
        controlNames: ['qtarget qfinal'],
      }),
      sourceRunId: 'run-procedure-selected-ui-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 50 },
      now: 1_200,
    }).fact;
    const selected = [procedure, selectedUi];
    const scoredById = new Map([
      [procedure.id, scored(procedure, 1)],
      [selectedUi.id, scored(selectedUi, 0.9)],
    ]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: Array.from(scoredById.values()),
      limit: 3,
      uiSupportBudget: 1,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qtarget']),
      recallLexicalUnits: ['qtarget'],
      unitWeights: new Map([['qtarget', 1]]),
      query: 'qtarget',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([procedure.id, endpointUi.id, selectedUi.id]);
  });

  it('recall gives selected procedures an endpoint support attempt when UI slots are full', async () => {
    const corpus = upsertEntity({ name: 'procedure-endpoint-budget-support', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-budget-support',
        goal: 'qtarget procedure',
        steps: [
          { stateIndex: '21', action: 'click qearly-action' },
          { stateIndex: '49', action: 'click qfinal-action' },
          { stateIndex: '50', action: 'observe qfinal-state' },
        ],
      }),
      sourceRunId: 'run-procedure-budget-support',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const earlyUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-budget-support',
        stateIndex: '21',
        controlNames: ['qtarget qearly'],
      }),
      sourceRunId: 'run-procedure-budget-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 21 },
      now: 1_100,
    }).fact;
    const endpointUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-budget-support',
        stateIndex: '50',
        controlNames: ['qfinal-endpoint'],
      }),
      sourceRunId: 'run-procedure-budget-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 50 },
      now: 1_200,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-budget-filler',
        stateIndex: '3',
        controlNames: ['qtarget qfiller'],
      }),
      sourceRunId: 'run-procedure-budget-filler',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 3 },
      now: 1_300,
    });

    const facts = await recallFactsForQuery('qtarget', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 2_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(procedure.id);
    expect(selectedIds).toContain(earlyUi.id);
    expect(selectedIds).toContain(endpointUi.id);
  });
});
