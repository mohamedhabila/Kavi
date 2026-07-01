// ---------------------------------------------------------------------------
// Tests - Query-time UI anchored procedure support
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

describe('recallFactsForQuery - UI anchored procedure support', () => {
  it('adds same-source procedure context for a selected UI anchor', async () => {
    const corpus = upsertEntity({ name: 'ui-procedure-support-corpus', type: 'concept' });
    const unrelatedProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'unrelated_procedure',
      objectText: JSON.stringify({
        goal: 'qsurfaceanchor qflowintent qdominant',
        actionTransitions: [{ observedAction: 'click qdominant' }],
      }),
      sourceRunId: 'run-unrelated-procedure',
      memoryKind: 'procedure',
      retrievability: 1,
      importance: 1,
      now: 1_000,
    }).fact;
    const targetUi = recordFact({
      subjectId: corpus.id,
      predicate: 'target_ui',
      objectText: JSON.stringify({
        controlNames: ['qsurfaceanchor qflowintent'],
        stateIndex: '4',
        url: 'https://example.test/target',
      }),
      sourceRunId: 'run-ui-procedure-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4, url: 'https://example.test/target' },
      retrievability: 1,
      importance: 1,
      now: 2_000,
    }).fact;
    const targetProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'target_procedure',
      objectText: JSON.stringify({
        goal: 'stored navigation provenance',
        actionTransitions: [
          { observedAction: 'click qtarget-step-one' },
          { observedAction: 'click qtarget-step-two' },
        ],
      }),
      sourceRunId: 'run-ui-procedure-support',
      memoryKind: 'procedure',
      retrievability: 0.35,
      now: 1_500,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'filler_ui',
      objectText: JSON.stringify({
        controlNames: ['qsurfaceanchor qflowintent qfiller'],
        stateIndex: '1',
        url: 'https://example.test/filler',
      }),
      sourceRunId: 'run-filler-ui',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 1, url: 'https://example.test/filler' },
      now: 3_000,
    });

    const facts = await recallFactsForQuery('qsurfaceanchor qflowintent', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(unrelatedProcedure.id);
    expect(selectedIds).toContain(targetUi.id);
    expect(selectedIds).toContain(targetProcedure.id);
    expect(selectedIds.indexOf(targetProcedure.id)).toBeGreaterThan(
      selectedIds.indexOf(targetUi.id),
    );
  });

  it('replaces unrelated context when selected UI evidence needs same-source procedure support', () => {
    const corpus = upsertEntity({ name: 'ui-procedure-overflow-support', type: 'concept' });
    const unrelatedProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-unrelated-ui-procedure-overflow',
        steps: [{ stateIndex: '1', action: 'qunrelated qprocedure' }],
      }),
      sourceRunId: 'run-unrelated-ui-procedure-overflow',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const selectedUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-ui-procedure-overflow',
        stateIndex: '4',
        controlNames: ['qui qselected qsurface'],
      }),
      sourceRunId: 'run-ui-procedure-overflow',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4 },
      now: 2_000,
    }).fact;
    const selectedOutcome = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        sourceRunId: 'run-outcome-to-preserve',
        stateIndex: '2',
        thought: 'qoutcome qpreserve',
      }),
      sourceRunId: 'run-outcome-to-preserve',
      memoryKind: 'outcome',
      attributes: { stateIndex: 2 },
      now: 2_500,
    }).fact;
    const sameSourceProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-ui-procedure-overflow',
        steps: [
          { stateIndex: '1', action: 'open qworkflow' },
          { stateIndex: '4', action: 'continue qworkflow' },
        ],
      }),
      sourceRunId: 'run-ui-procedure-overflow',
      memoryKind: 'procedure',
      now: 1_500,
    }).fact;
    const selected = [unrelatedProcedure, selectedUi, selectedOutcome];
    const scoredById = new Map([
      [unrelatedProcedure.id, scored(unrelatedProcedure, 0.9)],
      [selectedUi.id, scored(selectedUi, 0.8)],
      [selectedOutcome.id, scored(selectedOutcome, 0.7)],
    ]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: Array.from(scoredById.values()),
      limit: 3,
      uiSupportBudget: 0,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 1,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qui', 'qselected']),
      recallLexicalUnits: ['qui', 'qselected'],
      unitWeights: new Map([
        ['qui', 1],
        ['qselected', 1],
      ]),
      query: 'qui qselected',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 3_000,
    });

    const selectedIds = selected.map((fact) => fact.id);
    expect(selectedIds).toContain(selectedUi.id);
    expect(selectedIds).toContain(selectedOutcome.id);
    expect(selectedIds).toContain(sameSourceProcedure.id);
    expect(selectedIds).not.toContain(unrelatedProcedure.id);
    expect(selected).toHaveLength(3);
  });

  it('does not retain rejected support bookkeeping when no unrelated context can be removed', () => {
    const corpus = upsertEntity({ name: 'ui-procedure-overflow-rejected', type: 'concept' });
    const selectedUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-ui-procedure-rejected',
        stateIndex: '4',
        controlNames: ['qfull qpacket qsurface'],
      }),
      sourceRunId: 'run-ui-procedure-rejected',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4 },
      now: 2_000,
    }).fact;
    const selectedOutcome = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        sourceRunId: 'run-ui-procedure-rejected',
        stateIndex: '5',
        thought: 'qfull qpacket qresult',
      }),
      sourceRunId: 'run-ui-procedure-rejected',
      memoryKind: 'outcome',
      attributes: { stateIndex: 5 },
      now: 2_500,
    }).fact;
    const sameSourceProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-ui-procedure-rejected',
        steps: [
          { stateIndex: '1', action: 'qworkflow qone' },
          { stateIndex: '4', action: 'qworkflow qtwo' },
        ],
      }),
      sourceRunId: 'run-ui-procedure-rejected',
      memoryKind: 'procedure',
      now: 1_500,
    }).fact;
    const selected = [selectedUi, selectedOutcome];
    const seenIds = new Set(selected.map((fact) => fact.id));
    const seenKeys = new Set<string>();
    const scoredById = new Map([
      [selectedUi.id, scored(selectedUi, 0.8)],
      [selectedOutcome.id, scored(selectedOutcome, 0.7)],
    ]);

    insertProcedureLocalSupport({
      selected,
      seenIds,
      seenKeys,
      scoredById,
      scored: Array.from(scoredById.values()),
      limit: 2,
      uiSupportBudget: 0,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 1,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qfull', 'qpacket']),
      recallLexicalUnits: ['qfull', 'qpacket'],
      unitWeights: new Map([
        ['qfull', 1],
        ['qpacket', 1],
      ]),
      query: 'qfull qpacket',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 3_000,
    });

    expect(selected.map((fact) => fact.id)).toEqual([selectedUi.id, selectedOutcome.id]);
    expect(seenIds.has(sameSourceProcedure.id)).toBe(false);
    expect(scoredById.has(sameSourceProcedure.id)).toBe(false);
    expect(Array.from(seenKeys)).toEqual([]);
  });

  it('uses same-state UI evidence when a selected procedure needs local action context', () => {
    const corpus = upsertEntity({ name: 'procedure-same-state-ui-support', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-same-state-support',
        steps: [
          { stateIndex: '4', action: 'click qopen-menu' },
          { stateIndex: '5', action: 'click qafter-menu' },
        ],
      }),
      sourceRunId: 'run-procedure-same-state-support',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const sameStateUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-same-state-support',
        stateIndex: '4',
        controlNames: ['qdecision qmenu qaction'],
      }),
      sourceRunId: 'run-procedure-same-state-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4 },
      now: 1_100,
    }).fact;
    const downstreamUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-same-state-support',
        stateIndex: '5',
        fields: [
          { role: 'combobox', controlName: 'qdownstream', options: ['qa', 'qb', 'qc'] },
          { role: 'textbox', controlName: 'qdownstream-extra' },
        ],
        visibleTextSnippets: [
          { text: 'qdownstream-rich-a' },
          { text: 'qdownstream-rich-b' },
        ],
      }),
      sourceRunId: 'run-procedure-same-state-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 5 },
      now: 1_200,
    }).fact;
    const selected = [procedure];
    const scoredById = new Map([[procedure.id, scored(procedure, 1)]]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: Array.from(scoredById.values()),
      limit: 2,
      uiSupportBudget: 1,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qdecision', 'qmenu']),
      recallLexicalUnits: ['qdecision', 'qmenu'],
      unitWeights: new Map([
        ['qdecision', 1],
        ['qmenu', 1],
      ]),
      query: 'qdecision qmenu',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    const selectedIds = selected.map((fact) => fact.id);
    expect(selectedIds).toContain(sameStateUi.id);
    expect(selectedIds).not.toContain(downstreamUi.id);
    expect(selectedIds.indexOf(sameStateUi.id)).toBeGreaterThan(selectedIds.indexOf(procedure.id));
  });

  it('uses remaining procedure UI budget for adjacent result state evidence', () => {
    const corpus = upsertEntity({ name: 'procedure-adjacent-ui-support', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-adjacent-support',
        steps: [
          { stateIndex: '4', action: 'click qchoose-path' },
          { stateIndex: '5', action: 'click qconfirm-path' },
        ],
      }),
      sourceRunId: 'run-procedure-adjacent-support',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const decisionUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-adjacent-support',
        stateIndex: '4',
        controlNames: ['qdecision qchoice'],
      }),
      sourceRunId: 'run-procedure-adjacent-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4 },
      now: 1_100,
    }).fact;
    const resultUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-adjacent-support',
        stateIndex: '5',
        controlNames: ['qresult qconfirmation'],
      }),
      sourceRunId: 'run-procedure-adjacent-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 5 },
      now: 1_200,
    }).fact;
    const selected = [procedure];
    const scoredById = new Map([[procedure.id, scored(procedure, 1)]]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: Array.from(scoredById.values()),
      limit: 3,
      uiSupportBudget: 2,
      procedureSupportBudget: 0,
      uiProcedureSupportBudget: 0,
      candidateScopes: undefined,
      options: {},
      scoringQueryUnits: new Set(['qdecision', 'qchoice', 'qresult', 'qconfirmation']),
      recallLexicalUnits: ['qdecision', 'qchoice', 'qresult', 'qconfirmation'],
      unitWeights: new Map([
        ['qdecision', 1],
        ['qchoice', 1],
        ['qresult', 1],
        ['qconfirmation', 1],
      ]),
      query: 'qdecision qchoice qresult qconfirmation',
      anchorUnitSets: [],
      alwaysIncludePinned: false,
      now: 2_000,
    });

    const selectedIds = selected.map((fact) => fact.id);
    expect(selectedIds).toHaveLength(3);
    expect(selectedIds[0]).toBe(procedure.id);
    expect(selectedIds).toContain(decisionUi.id);
    expect(selectedIds).toContain(resultUi.id);
    expect(selectedIds.indexOf(decisionUi.id)).toBeGreaterThan(selectedIds.indexOf(procedure.id));
    expect(selectedIds.indexOf(resultUi.id)).toBeGreaterThan(selectedIds.indexOf(procedure.id));
  });

  it('prefers procedure-adjacent UI support over distant same-run UI matches', () => {
    const corpus = upsertEntity({ name: 'procedure-local-ui-support', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-local-support',
        steps: [
          { stateIndex: '0', action: 'click qstart' },
          { stateIndex: '20', action: 'click qfinish' },
        ],
      }),
      sourceRunId: 'run-procedure-local-support',
      memoryKind: 'procedure',
      now: 1_000,
    }).fact;
    const distantUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-local-support',
        stateIndex: '12',
        controlNames: ['qtarget qdistant qrich'],
        fields: [
          { role: 'textbox', controlName: 'qtarget qdistant-field' },
          { role: 'combobox', controlName: 'qtarget qdistant-combo', options: ['qa', 'qb'] },
        ],
      }),
      sourceRunId: 'run-procedure-local-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 12 },
      now: 1_300,
    }).fact;
    const endpointUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-local-support',
        stateIndex: '20',
        controlNames: ['qtarget qendpoint'],
      }),
      sourceRunId: 'run-procedure-local-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 20 },
      now: 1_100,
    }).fact;
    const selected = [procedure];
    const scoredById = new Map([[procedure.id, scored(procedure, 1)]]);

    insertProcedureLocalSupport({
      selected,
      seenIds: new Set(selected.map((fact) => fact.id)),
      seenKeys: new Set(),
      scoredById,
      scored: [scored(procedure, 1), scored(distantUi, 10)],
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

});
