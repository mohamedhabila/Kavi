// ---------------------------------------------------------------------------
// Tests — Query-time workflow support recall
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

describe('recallFactsForQuery — workflow support', () => {
  it('adds relevant downstream UI states as workflow support', async () => {
    const corpus = upsertEntity({ name: 'downstream-state-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target_anchor',
      objectText: JSON.stringify({
        fields: [{ role: 'textbox', controlName: 'qterminalanchor' }],
        url: 'https://example.test/workflow/form?record=target',
        stateIndex: '2',
      }),
      sourceRunId: 'run-terminal-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 2 },
      importance: 1,
      now: 2_000,
    });
    const distantSetup = recordFact({
      subjectId: corpus.id,
      predicate: 'distant_setup',
      objectText: 'qterminalsetup',
      sourceRunId: 'run-terminal-support',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 0 },
      now: 1_000,
    }).fact;
    const adjacent = recordFact({
      subjectId: corpus.id,
      predicate: 'adjacent_context',
      objectText: JSON.stringify({
        fields: [{ role: 'textbox', controlName: 'qterminalanchor' }],
        url: 'https://example.test/workflow/form?record=adjacent',
        stateIndex: '3',
      }),
      sourceRunId: 'run-terminal-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 3 },
      now: 3_000,
    }).fact;
    const downstream = recordFact({
      subjectId: corpus.id,
      predicate: 'downstream_actions',
      objectText: JSON.stringify({
        controlNames: ['qterminalanchor', 'qterminalaction'],
        url: 'https://example.test/workflow/result?record=target',
        stateIndex: '12',
      }),
      sourceRunId: 'run-terminal-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 12 },
      now: 4_000,
    }).fact;
    const laterUnrelated = recordFact({
      subjectId: corpus.id,
      predicate: 'later_unrelated',
      objectText: JSON.stringify({
        controlNames: ['qunrelatedlater'],
        stateIndex: '24',
      }),
      sourceRunId: 'run-terminal-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 24 },
      now: 6_000,
    }).fact;

    const facts = await recallFactsForQuery('qterminalanchor', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 7_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(target.fact.id);
    expect(selectedIds).toContain(downstream.id);
    if (selectedIds.includes(adjacent.id)) {
      expect(selectedIds.indexOf(downstream.id)).toBeLessThan(selectedIds.indexOf(adjacent.id));
    }
    expect(selectedIds).not.toContain(distantSetup.id);
    expect(selectedIds).not.toContain(laterUnrelated.id);
  });

  it('prunes conflicting UI surfaces after source-run support finds a stronger surface identity', async () => {
    const corpus = upsertEntity({ name: 'support-surface-identity-corpus', type: 'concept' });
    recordFact({
      subjectId: corpus.id,
      predicate: 'requested_catalog_anchor',
      objectText: JSON.stringify({
        surfaceLabels: ['qcatalog'],
        controlNames: ['qrequested qitem qmac'],
        url: 'https://example.test/catalog',
        stateIndex: '1',
      }),
      sourceRunId: 'run-requested-surface-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 1, url: 'https://example.test/catalog' },
      retrievability: 0.98,
      now: 1_000,
    });
    const requestedDetail = recordFact({
      subjectId: corpus.id,
      predicate: 'requested_detail',
      objectText: JSON.stringify({
        surfaceLabels: ['qrequested qitem qmac'],
        fieldLabels: ['qother-config'],
        url: 'https://example.test/catalog/requested',
        stateIndex: '3',
      }),
      sourceRunId: 'run-requested-surface-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 3, url: 'https://example.test/catalog/requested' },
      retrievability: 0.98,
      now: 2_000,
    }).fact;
    const conflictingDetail = recordFact({
      subjectId: corpus.id,
      predicate: 'conflicting_detail',
      objectText: JSON.stringify({
        surfaceLabels: ['qsimilar qitem qpc'],
        fieldLabels: ['qdrive qsize', 'qstorage 250', 'qstorage 500'],
        url: 'https://example.test/catalog/similar',
        stateIndex: '5',
      }),
      sourceRunId: 'run-conflicting-surface',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 5, url: 'https://example.test/catalog/similar' },
      retrievability: 0.98,
      now: 3_000,
    }).fact;

    const facts = await recallFactsForQuery('qrequested qitem qmac qdrive qsize qstorage', {
      memoryKind: 'ui_inventory',
      limit: 4,
      threshold: 0,
      candidatePoolLimit: 20,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(requestedDetail.id);
    expect(selectedIds).not.toContain(conflictingDetail.id);
  });

  it('uses source-run order as the tie-breaker for equally relevant workflow support', async () => {
    const corpus = upsertEntity({ name: 'support-provenance-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target_primary',
      objectText: JSON.stringify({
        fields: [{ role: 'textbox', controlName: 'qsourceanchor qsourceextra' }],
        url: 'https://example.test/target/form',
        stateIndex: '1',
      }),
      sourceRunId: 'run-support-target',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 1 },
      now: 1_000,
    }).fact;
    const competitor = recordFact({
      subjectId: corpus.id,
      predicate: 'competitor_primary',
      objectText: JSON.stringify({
        fields: [{ role: 'textbox', controlName: 'qsourceanchor qsourceextra' }],
        url: 'https://example.test/competitor/form',
        stateIndex: '1',
      }),
      sourceRunId: 'run-support-competitor',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 1 },
      now: 900,
    }).fact;
    const filler = recordFact({
      subjectId: corpus.id,
      predicate: 'filler_primary',
      objectText: 'qsourceanchor qfiller',
      sourceRunId: 'run-support-filler',
      now: 800,
    }).fact;
    const targetSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'target_result',
      objectText: JSON.stringify({
        controlNames: ['qsourceanchor'],
        url: 'https://example.test/target/result',
        stateIndex: '8',
      }),
      sourceRunId: 'run-support-target',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 8 },
      now: 2_000,
    }).fact;
    const competitorSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'competitor_result',
      objectText: JSON.stringify({
        controlNames: ['qsourceanchor'],
        url: 'https://example.test/competitor/result',
        stateIndex: '8',
      }),
      sourceRunId: 'run-support-competitor',
      memoryKind: 'ui_inventory',
      importance: 0,
      attributes: { stateIndex: 8 },
      now: 2_000,
    }).fact;

    const facts = await recallFactsForQuery('qsourceanchor qsourceextra', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds.slice(0, 3)).toEqual([target.id, competitor.id, filler.id]);
    expect(selectedIds).toContain(targetSupport.id);
    expect(selectedIds).not.toContain(competitorSupport.id);
  });

  it('lets stronger workflow support evidence override source-run order', async () => {
    const corpus = upsertEntity({ name: 'support-relevance-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target_primary',
      objectText: JSON.stringify({
        fields: [{ role: 'textbox', controlName: 'qrelevanceanchor qrelevanceextra' }],
        url: 'https://example.test/target/form',
        stateIndex: '1',
      }),
      sourceRunId: 'run-relevance-target',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 1 },
      now: 1_000,
    }).fact;
    const competitor = recordFact({
      subjectId: corpus.id,
      predicate: 'competitor_primary',
      objectText: JSON.stringify({
        fields: [{ role: 'textbox', controlName: 'qrelevanceanchor qrelevanceextra' }],
        url: 'https://example.test/competitor/form',
        stateIndex: '1',
      }),
      sourceRunId: 'run-relevance-competitor',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 1 },
      now: 900,
    }).fact;
    const filler = recordFact({
      subjectId: corpus.id,
      predicate: 'filler_primary',
      objectText: 'qrelevanceanchor qfiller',
      sourceRunId: 'run-relevance-filler',
      now: 800,
    }).fact;
    const targetSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'target_result',
      objectText: JSON.stringify({
        controlNames: ['qrelevanceanchor'],
        url: 'https://example.test/target/result',
        stateIndex: '8',
      }),
      sourceRunId: 'run-relevance-target',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 8 },
      now: 2_000,
    }).fact;
    const competitorSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'competitor_result',
      objectText: JSON.stringify({
        controlNames: ['qrelevanceanchor', 'qrelevanceextra'],
        url: 'https://example.test/competitor/result',
        stateIndex: '8',
      }),
      sourceRunId: 'run-relevance-competitor',
      memoryKind: 'ui_inventory',
      importance: 0,
      attributes: { stateIndex: 8 },
      now: 3_000,
    }).fact;

    const facts = await recallFactsForQuery('qrelevanceanchor qrelevanceextra', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds.slice(0, 3)).toEqual([target.id, competitor.id, filler.id]);
    expect(selectedIds).toContain(competitorSupport.id);
    expect(selectedIds).not.toContain(targetSupport.id);
  });

  it('does not add duplicate action-result support for a source that already has an action result', async () => {
    const corpus = upsertEntity({ name: 'action-result-support-dedupe-corpus', type: 'concept' });
    const primary = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qdedupeanchor qprimary-action',
      sourceRunId: 'run-action-dedupe',
      memoryKind: 'outcome',
      attributes: { stateIndex: 8 },
      importance: 1,
      now: 3_000,
    }).fact;
    const duplicateSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qdedupeanchor qduplicate-support',
      sourceRunId: 'run-action-dedupe',
      memoryKind: 'outcome',
      attributes: { stateIndex: 2 },
      importance: 0.9,
      now: 2_000,
    }).fact;
    const otherA = recordFact({
      subjectId: corpus.id,
      predicate: 'other_a',
      objectText: 'qdedupeanchor qother-a',
      sourceRunId: 'run-action-other-a',
      now: 1_000,
    }).fact;
    const otherB = recordFact({
      subjectId: corpus.id,
      predicate: 'other_b',
      objectText: 'qdedupeanchor qother-b',
      sourceRunId: 'run-action-other-b',
      now: 900,
    }).fact;

    const facts = await recallFactsForQuery('qdedupeanchor', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 20,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toEqual(expect.arrayContaining([primary.id, otherA.id, otherB.id]));
    expect(selectedIds).not.toContain(duplicateSupport.id);
  });

  it('uses selected procedure states as workflow support anchors', async () => {
    const corpus = upsertEntity({ name: 'procedure-support-corpus', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_target',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-target',
        goal: 'qprocanchor qprocquery',
        steps: [{ stateIndex: '1' }, { stateIndex: '2' }],
      }),
      sourceRunId: 'run-procedure-target',
      memoryKind: 'procedure',
      importance: 1,
      now: 1_000,
    }).fact;
    const fillerA = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_filler_a',
      objectText: 'qprocanchor qfilleralpha',
      importance: 1,
      now: 800,
    }).fact;
    const fillerB = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_filler_b',
      objectText: 'qprocanchor qfillerbeta',
      importance: 1,
      now: 700,
    }).fact;
    const adjacentUi = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_adjacent_ui',
      objectText: JSON.stringify({
        controlNames: ['qvisible-grounding'],
        url: 'https://example.test/target/result',
        stateIndex: '2',
      }),
      sourceRunId: 'run-procedure-target',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 2, url: 'https://example.test/target/result' },
      now: 2_000,
    }).fact;
    const distantUi = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_distant_ui',
      objectText: JSON.stringify({
        controlNames: ['qdistant-grounding'],
        url: 'https://example.test/target/late',
        stateIndex: '30',
      }),
      sourceRunId: 'run-procedure-target',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 30, url: 'https://example.test/target/late' },
      now: 3_000,
    }).fact;

    const facts = await recallFactsForQuery('qprocanchor qprocquery qfilleralpha qfillerbeta', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds.slice(0, 3)).toEqual(
      expect.arrayContaining([procedure.id, fillerA.id, fillerB.id]),
    );
    expect(selectedIds).toContain(adjacentUi.id);
    expect(selectedIds).not.toContain(distantUi.id);
  });

  it('uses query-matched procedure states for precise workflow support', async () => {
    const corpus = upsertEntity({ name: 'query-phase-procedure-support-corpus', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_target',
      objectText: JSON.stringify({
        sourceRunId: 'run-query-phase-procedure-target',
        goal: 'qphaseprocanchor qphaseprocquery',
        stepCount: 11,
        steps: Array.from({ length: 11 }, (_, index) => ({
          stateIndex: String(index),
          thought: index === 5 ? 'qphase-target' : `qphase-step-${index}`,
        })),
      }),
      sourceRunId: 'run-query-phase-procedure-target',
      memoryKind: 'procedure',
      importance: 1,
      now: 1_000,
    }).fact;
    const fillerA = recordFact({
      subjectId: corpus.id,
      predicate: 'late_procedure_filler_a',
      objectText: 'qphaseprocanchor qfillera',
      importance: 1,
      now: 900,
    }).fact;
    const fillerB = recordFact({
      subjectId: corpus.id,
      predicate: 'late_procedure_filler_b',
      objectText: 'qphaseprocanchor qfillerb',
      importance: 1,
      now: 800,
    }).fact;
    const phaseTab = recordFact({
      subjectId: corpus.id,
      predicate: 'query_phase_tab',
      objectText: JSON.stringify({
        role: 'tab',
        name: 'qphase-target',
        selected: true,
        expanded: true,
        url: 'https://example.test/flow/middle',
        stateIndex: '5',
      }),
      sourceRunId: 'run-query-phase-procedure-target',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 5, url: 'https://example.test/flow/middle' },
      now: 1_200,
    }).fact;
    const preciseField = recordFact({
      subjectId: corpus.id,
      predicate: 'query_phase_field',
      objectText: JSON.stringify({
        label: 'qcritical-field',
        role: 'textbox',
        controlName: 'qcritical-field',
        required: true,
        disabled: true,
        url: 'https://example.test/flow/middle',
        stateIndex: '5',
      }),
      sourceRunId: 'run-query-phase-procedure-target',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 5, url: 'https://example.test/flow/middle' },
      now: 1_300,
    }).fact;

    const facts = await recallFactsForQuery(
      'qphaseprocanchor qphaseprocquery qphase-target qfillera qfillerb',
      {
        limit: 5,
        threshold: 0.01,
        candidatePoolLimit: 40,
        now: 2_000,
      },
    );
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds.slice(0, 3)).toEqual(
      expect.arrayContaining([procedure.id, fillerA.id, fillerB.id]),
    );
    expect(selectedIds).toContain(preciseField.id);
    expect(selectedIds).not.toContain(phaseTab.id);
  });

  it('uses a compact procedure representative for intermediate workflow outcomes', async () => {
    const corpus = upsertEntity({ name: 'workflow-representative-corpus', type: 'concept' });
    const intermediateOutcome = recordFact({
      subjectId: corpus.id,
      predicate: 'workflow_outcome',
      objectText: JSON.stringify({
        thought: 'qtrailanchor qtrailfocus intermediate screen is visible',
        stateIndex: '2',
      }),
      sourceRunId: 'run-workflow-representative',
      memoryKind: 'outcome',
      importance: 1,
      attributes: { stateIndex: 2 },
      now: 2_000,
    }).fact;
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-workflow-representative',
        goal: 'qtrailanchor qtrailfocus',
        stepCount: 5,
        steps: [
          { stateIndex: '0', thought: 'setup' },
          { stateIndex: '1', thought: 'open flow' },
          { stateIndex: '2', thought: 'intermediate screen is visible' },
          { stateIndex: '3', thought: 'qdownstream-phase appears' },
          { stateIndex: '4', thought: 'final phase appears' },
        ],
      }),
      sourceRunId: 'run-workflow-representative',
      memoryKind: 'procedure',
      importance: 0.6,
      now: 1_500,
    }).fact;

    const facts = await recallFactsForQuery('qtrailanchor qtrailfocus', {
      limit: 1,
      threshold: 0.01,
      candidatePoolLimit: 20,
      now: 3_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(procedure.id);
    expect(selectedIds).not.toContain(intermediateOutcome.id);
  });

  it('uses max procedure state index for representatives when traces skip steps', async () => {
    const corpus = upsertEntity({ name: 'workflow-skipped-state-corpus', type: 'concept' });
    const lateOutcome = recordFact({
      subjectId: corpus.id,
      predicate: 'workflow_outcome',
      objectText: JSON.stringify({
        thought: 'qskippedanchor qskippedfocus late screen is visible',
        stateIndex: '64',
      }),
      sourceRunId: 'run-workflow-skipped-state',
      memoryKind: 'outcome',
      importance: 1,
      attributes: { stateIndex: 64 },
      now: 2_000,
    }).fact;
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-workflow-skipped-state',
        goal: 'qskippedanchor qskippedfocus',
        stepCount: 3,
        steps: [
          { stateIndex: '1', thought: 'setup' },
          { stateIndex: '64', thought: 'qskippedfocus current phase' },
          { stateIndex: '70', thought: 'qskipped-downstream phase appears' },
        ],
      }),
      sourceRunId: 'run-workflow-skipped-state',
      memoryKind: 'procedure',
      importance: 0.6,
      now: 1_500,
    }).fact;

    const facts = await recallFactsForQuery('qskippedanchor qskippedfocus', {
      limit: 1,
      threshold: 0.01,
      candidatePoolLimit: 20,
      now: 3_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(procedure.id);
    expect(selectedIds).not.toContain(lateOutcome.id);
  });

  it('prefers precise label-value state over broad inventory as workflow support', async () => {
    const corpus = upsertEntity({ name: 'label-value-support-corpus', type: 'concept' });
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_target',
      objectText: JSON.stringify({
        sourceRunId: 'run-label-value-support',
        goal: 'qstateanchor',
        steps: [{ stateIndex: '4' }],
      }),
      sourceRunId: 'run-label-value-support',
      memoryKind: 'procedure',
      importance: 1,
      now: 1_000,
    }).fact;
    const inventory = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['qcoarse-action'],
        sections: [{ label: 'qcoarse-section', controlNames: ['qcoarse-action'] }],
        url: 'https://mobile.example.test/thread',
        sourceRunId: 'run-label-value-support',
        stateIndex: '4',
      }),
      sourceRunId: 'run-label-value-support',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4 },
      now: 1_200,
    }).fact;
    const labelValueState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_filter_state',
      objectText: JSON.stringify({
        label: 'qprecise-label',
        value: 'qprecise-value',
        nearbyTextBefore: ['qstateanchor'],
        url: 'https://mobile.example.test/thread',
        sourceRunId: 'run-label-value-support',
        stateIndex: '4',
      }),
      sourceRunId: 'run-label-value-support',
      memoryKind: 'ui_filter_state',
      attributes: { stateIndex: 4 },
      now: 1_300,
    }).fact;

    const facts = await recallFactsForQuery('qstateanchor', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 20,
      now: 2_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(procedure.id);
    expect(selectedIds).toContain(labelValueState.id);
    expect(selectedIds).not.toContain(inventory.id);
  });

});
