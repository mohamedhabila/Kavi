// ---------------------------------------------------------------------------
// Tests - Procedure endpoint UI support
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
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

describe('procedure boundary UI support', () => {
  it('anchors procedure UI support to the first boundary when the starting state is observed', () => {
    const corpus = upsertEntity({ name: 'procedure-boundary-ui-support', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-boundary-support',
        steps: [
          { stateIndex: '0', action: 'observe qstart' },
          { stateIndex: '5', action: 'observe qfinal' },
        ],
      }),
      sourceRunId: 'run-procedure-boundary-support',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const startUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-boundary-support',
        stateIndex: '0',
        controlNames: ['qtarget qstart'],
      }),
      sourceRunId: 'run-procedure-boundary-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 0 },
      now: 1_100,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-boundary-support',
        stateIndex: '5',
        controlNames: ['qtarget qfinal'],
      }),
      sourceRunId: 'run-procedure-boundary-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 5 },
      now: 1_200,
    });
    const selected = [procedure];
    const scoredById = new Map([[procedure.id, scored(procedure, 1)]]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: [scored(procedure, 1)],
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

    expect(selected.map((fact) => fact.id)).toEqual([procedure.id, startUi.id]);
  });

  it('anchors procedure UI support to the first action-bearing state after passive setup', () => {
    const corpus = upsertEntity({ name: 'procedure-action-step-support', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-action-step-support',
        steps: [
          { stateIndex: '0', thought: 'observe qpassive setup' },
          { stateIndex: '1', action: 'click qfirst-action' },
          { stateIndex: '5', action: 'click qfinal-action' },
        ],
      }),
      sourceRunId: 'run-procedure-action-step-support',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-action-step-support',
        stateIndex: '0',
        controlNames: ['qtarget qpassive'],
      }),
      sourceRunId: 'run-procedure-action-step-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 0 },
      retrievability: 1,
      now: 1_100,
    });
    const firstActionUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-action-step-support',
        stateIndex: '1',
        controlNames: ['qtarget qfirst-action-state'],
      }),
      sourceRunId: 'run-procedure-action-step-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 1 },
      now: 1_200,
    }).fact;
    const selected = [procedure];
    const scoredById = new Map([[procedure.id, scored(procedure, 1)]]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: [scored(procedure, 1)],
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

    expect(selected.map((fact) => fact.id)).toEqual([procedure.id, firstActionUi.id]);
  });

  it('prefers structural navigation state over passive label state for procedure continuation', () => {
    const corpus = upsertEntity({ name: 'procedure-navigation-state-support', type: 'concept' });
    const sourceRunId = 'run-procedure-navigation-state-support';
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        actionTransitions: [
          {
            fromStateIndex: '1',
            toStateIndex: '2',
            observedAction: 'qcontinue qsurface',
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_label_value',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '2',
        label: 'qsurface',
        value: 'qpassive',
      }),
      sourceRunId,
      memoryKind: 'ui_filter_state',
      attributes: { stateIndex: 2 },
      retrievability: 0.9,
      now: 1_100,
    });
    const navigationState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '2',
        role: 'tab',
        controlName: 'qsurface',
        options: ['qpanel-alpha', 'qpanel-beta'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 2 },
      retrievability: 0.8,
      now: 1_200,
    }).fact;
    const selected = [procedure];
    const scoredById = new Map([[procedure.id, scored(procedure, 1)]]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: [scored(procedure, 1)],
      limit: 2,
      uiSupportBudget: 1,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qsurface']),
      recallLexicalUnits: ['qsurface'],
      unitWeights: new Map([['qsurface', 1]]),
      query: 'qsurface',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([procedure.id, navigationState.id]);
  });

  it('does not let selected scalar state evidence suppress same-state controls', () => {
    const corpus = upsertEntity({ name: 'procedure-scalar-state-support', type: 'concept' });
    const sourceRunId = 'run-procedure-scalar-state-support';
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        actionTransitions: [
          {
            fromStateIndex: '1',
            toStateIndex: '2',
            observedAction: 'qcontinue qsurface',
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const scalarState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_label_value',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '2',
        label: 'qsurface',
        value: 'qpassive',
      }),
      sourceRunId,
      memoryKind: 'ui_filter_state',
      attributes: { stateIndex: 2 },
      retrievability: 0.9,
      now: 1_100,
    }).fact;
    const navigationState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '2',
        role: 'tab',
        controlName: 'qsurface',
        options: ['qpanel-alpha', 'qpanel-beta'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 2 },
      retrievability: 0.8,
      now: 1_200,
    }).fact;
    const selected = [procedure, scalarState];
    const scoredById = new Map([
      [procedure.id, scored(procedure, 1)],
      [scalarState.id, scored(scalarState, 1)],
    ]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: [scored(procedure, 1), scored(scalarState, 1)],
      limit: 3,
      uiSupportBudget: 1,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qsurface']),
      recallLexicalUnits: ['qsurface'],
      unitWeights: new Map([['qsurface', 1]]),
      query: 'qsurface',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([
      procedure.id,
      navigationState.id,
      scalarState.id,
    ]);
  });

  it('does not let a selected field suppress another same-state control', () => {
    const corpus = upsertEntity({ name: 'procedure-same-state-field-support', type: 'concept' });
    const sourceRunId = 'run-procedure-same-state-field-support';
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        steps: [
          {
            stateIndex: '1',
            action: 'click qsetup-action',
            targetControl: { role: 'button', name: 'qsetup-control' },
          },
          {
            stateIndex: '4',
            action: 'click qtarget-action',
            targetControl: { role: 'menuitem', name: 'qtarget-control' },
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const selectedField = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '4',
        role: 'combobox',
        controlName: 'qunrelated-control',
        options: ['qunrelated-option'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
      retrievability: 1,
      now: 1_100,
    }).fact;
    const navigationState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '4',
        role: 'tab',
        controlName: 'qdestination-surface',
        options: ['qdestination-panel-a', 'qdestination-panel-b'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
      retrievability: 0.9,
      now: 1_200,
    }).fact;
    const selected = [procedure, selectedField];
    const scoredById = new Map([
      [procedure.id, scored(procedure, 1)],
      [selectedField.id, scored(selectedField, 1)],
    ]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: [scored(procedure, 1), scored(selectedField, 1)],
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

    expect(selected.map((fact) => fact.id)).toEqual([
      procedure.id,
      navigationState.id,
      selectedField.id,
    ]);
  });
});
