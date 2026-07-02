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

describe('procedure query-boundary UI support', () => {
  it('grounds procedure support at the transition most relevant to the current query', () => {
    const corpus = upsertEntity({ name: 'procedure-query-transition-support', type: 'concept' });
    const sourceRunId = 'run-procedure-query-transition-support';
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        actionTransitions: [
          {
            fromStateIndex: '0',
            toStateIndex: '1',
            observedAction: 'qsetup qother',
          },
          {
            fromStateIndex: '1',
            toStateIndex: '4',
            observedAction: 'qtarget-action qcontinue',
          },
          {
            fromStateIndex: '4',
            toStateIndex: '9',
            observedAction: 'qfinish qother',
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const matchedTransitionState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '4',
        role: 'tab',
        controlName: 'qtarget-surface',
        options: ['qtarget-panel'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
      now: 1_100,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '9',
        role: 'tab',
        controlName: 'qfinish-surface',
        options: ['qfinish-panel'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 9 },
      retrievability: 1,
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
      scoringQueryUnits: new Set(['qtarget', 'qcontinue']),
      recallLexicalUnits: ['qtarget', 'qcontinue'],
      unitWeights: new Map([
        ['qtarget', 1],
        ['qcontinue', 1],
      ]),
      query: 'qtarget qcontinue',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([procedure.id, matchedTransitionState.id]);
  });

  it('derives query-relevant support boundaries from stored procedure steps', () => {
    const corpus = upsertEntity({
      name: 'procedure-step-derived-boundary-support',
      type: 'concept',
    });
    const sourceRunId = 'run-procedure-step-derived-boundary-support';
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        steps: [
          {
            stateIndex: '1',
            url: 'surface-start',
            action: 'click qsetup-action',
            targetControl: { role: 'button', name: 'qsetup-control' },
          },
          {
            stateIndex: '4',
            url: 'surface-target',
            action: 'click qtarget-action',
            targetControl: { role: 'menuitem', name: 'qtarget-control' },
          },
          {
            stateIndex: '9',
            url: 'surface-finish',
            action: 'click qfinish-action',
            targetControl: { role: 'button', name: 'qfinish-control' },
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '1',
        role: 'tab',
        controlName: 'qtarget broad starting surface',
        options: ['qstart-panel'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 1 },
      retrievability: 1,
      now: 1_100,
    });
    const matchedStepState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '4',
        role: 'tab',
        controlName: 'qdestination-surface',
        options: ['qdestination-panel'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
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

    expect(selected.map((fact) => fact.id)).toEqual([procedure.id, matchedStepState.id]);
  });

  it('grounds procedure support from query-relevant surface trail entries', () => {
    const corpus = upsertEntity({ name: 'procedure-query-surface-trail-support', type: 'concept' });
    const sourceRunId = 'run-procedure-query-surface-trail-support';
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        actionTransitions: [
          {
            fromStateIndex: '0',
            toStateIndex: '1',
            observedAction: 'qsetup qother',
          },
          {
            fromStateIndex: '7',
            toStateIndex: '8',
            observedAction: 'qfinish qother',
          },
        ],
        surfaceTrail: [
          {
            stateIndex: '0',
            url: 'surface-qstart',
          },
          {
            stateIndex: '4',
            url: 'surface-qtarget',
            action: 'qtarget-action qcontinue',
            targetControl: { role: 'menuitem', name: 'qtarget-control' },
          },
          {
            stateIndex: '8',
            url: 'surface-qfinish',
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const matchedTrailState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '4',
        role: 'tab',
        controlName: 'qtarget-surface',
        options: ['qtarget-panel'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
      now: 1_100,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '8',
        role: 'tab',
        controlName: 'qfinish-surface',
        options: ['qfinish-panel'],
      }),
      sourceRunId,
      memoryKind: 'ui_field',
      attributes: { stateIndex: 8 },
      retrievability: 1,
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
      scoringQueryUnits: new Set(['qtarget', 'qcontinue']),
      recallLexicalUnits: ['qtarget', 'qcontinue'],
      unitWeights: new Map([
        ['qtarget', 1],
        ['qcontinue', 1],
      ]),
      query: 'qtarget qcontinue',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([procedure.id, matchedTrailState.id]);
  });

  it('prioritizes query-relevant procedure boundaries when support slots are scarce', () => {
    const corpus = upsertEntity({ name: 'procedure-query-boundary-priority', type: 'concept' });
    const unrelatedProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-boundary-unrelated',
        surfaceTrail: [
          {
            stateIndex: '1',
            action: 'qunrelated-action',
            targetControl: { role: 'button', name: 'qunrelated-control' },
          },
        ],
      }),
      sourceRunId: 'run-procedure-boundary-unrelated',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-boundary-unrelated',
        stateIndex: '1',
        role: 'tab',
        controlName: 'qunrelated-surface',
        options: ['qunrelated-panel'],
      }),
      sourceRunId: 'run-procedure-boundary-unrelated',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 1 },
      retrievability: 1,
      now: 1_100,
    });
    const relevantProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-boundary-relevant',
        surfaceTrail: [
          {
            stateIndex: '4',
            action: 'qtarget-action qcontinue',
            targetControl: { role: 'menuitem', name: 'qtarget-control' },
          },
        ],
      }),
      sourceRunId: 'run-procedure-boundary-relevant',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const relevantSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-boundary-relevant',
        stateIndex: '4',
        role: 'tab',
        controlName: 'qtarget-surface',
        options: ['qtarget-panel'],
      }),
      sourceRunId: 'run-procedure-boundary-relevant',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
      now: 1_200,
    }).fact;
    const selected = [unrelatedProcedure, relevantProcedure];
    const scoredById = new Map([
      [unrelatedProcedure.id, scored(unrelatedProcedure, 1)],
      [relevantProcedure.id, scored(relevantProcedure, 1)],
    ]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: [scored(unrelatedProcedure, 1), scored(relevantProcedure, 1)],
      limit: 3,
      uiSupportBudget: 1,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qtarget', 'qcontinue']),
      recallLexicalUnits: ['qtarget', 'qcontinue'],
      unitWeights: new Map([
        ['qtarget', 1],
        ['qcontinue', 1],
      ]),
      query: 'qtarget qcontinue',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([
      unrelatedProcedure.id,
      relevantProcedure.id,
      relevantSupport.id,
    ]);
  });
});
