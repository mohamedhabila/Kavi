// ---------------------------------------------------------------------------
// Tests - Query-time workflow support budget
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
import { supportSlotCount } from '../../../src/services/memory/ranking/selection';

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

describe('recallFactsForQuery - workflow support budget', () => {
  it('reserves support as grounding without crowding out relevant primary memories', async () => {
    const corpus = upsertEntity({ name: 'support-budget-corpus', type: 'concept' });
    const primaryFacts = [];
    for (let index = 0; index < 9; index += 1) {
      const sourceRunId = `run-support-budget-${index}`;
      primaryFacts.push(
        recordFact({
          subjectId: corpus.id,
          predicate: `primary_${index}`,
          objectText: JSON.stringify({
            sourceRunId,
            goal: 'qbudgetanchor qbudgetsurface qbudgetcategory qbudgetmodel',
            stepCount: 3,
            steps: [
              { stateIndex: 0, thought: 'qbudgetanchor qbudgetsurface' },
              { stateIndex: 1, action: 'click()' },
              { stateIndex: 2, outcome: 'success' },
            ],
          }),
          sourceRunId,
          memoryKind: 'procedure',
          now: 10_000 - index,
        }).fact,
      );
      recordFact({
        subjectId: corpus.id,
        predicate: `support_${index}`,
        objectText: JSON.stringify({
          controlNames: [`support-control-${index}`],
          url: `https://example.test/support/${index}`,
          stateIndex: '2',
        }),
        sourceRunId,
        memoryKind: 'ui_inventory',
        attributes: { stateIndex: 2, url: `https://example.test/support/${index}` },
        now: 20_000 + index,
      });
    }

    const facts = await recallFactsForQuery(
      'qbudgetanchor qbudgetsurface qbudgetcategory qbudgetmodel',
      {
        limit: 12,
        threshold: 0.01,
        candidatePoolLimit: 80,
        now: 30_000,
      },
    );
    const selectedIds = facts.map((fact) => fact.id);
    const selectedPrimaryCount = primaryFacts.filter((fact) =>
      selectedIds.includes(fact.id),
    ).length;
    const supportCount = facts.filter((fact) => fact.memoryKind === 'ui_inventory').length;

    expect(supportSlotCount(12)).toBe(4);
    expect(selectedPrimaryCount).toBeGreaterThanOrEqual(7);
    expect(supportCount).toBeLessThanOrEqual(4);
  });

  it('balances support across selected workflow sources when budget allows it', async () => {
    const corpus = upsertEntity({ name: 'support-balance-corpus', type: 'concept' });
    for (let index = 0; index < 3; index += 1) {
      const sourceRunId = `run-balanced-support-${index}`;
      recordFact({
        subjectId: corpus.id,
        predicate: `primary_${index}`,
        objectText: JSON.stringify({
          sourceRunId,
          goal: 'qbalanceanchor qbalancesurface qbalancecategory',
          stepCount: 12,
          steps: [
            { stateIndex: 0, thought: 'qbalanceanchor' },
            { stateIndex: 11, thought: 'qbalancesurface' },
          ],
        }),
        sourceRunId,
        memoryKind: 'procedure',
        now: 10_000 - index,
      });
      recordFact({
        subjectId: corpus.id,
        predicate: `support_${index}`,
        objectText: JSON.stringify({
          controlNames: [`qbalancesupport-value-${index}`],
          fields: [
            {
              role: 'combobox',
              controlName: 'qbalancesupport-control',
              value: 'qbalancesupport-current',
              options: ['qbalancesupport-current'],
            },
          ],
          url: `https://example.test/balanced/${index}`,
          stateIndex: '11',
        }),
        sourceRunId,
        memoryKind: 'ui_inventory',
        attributes: { stateIndex: 11, url: `https://example.test/balanced/${index}` },
        retrievability: index === 0 ? 0.99 : 0.5,
        now: 20_000 + index,
      });
    }

    const facts = await recallFactsForQuery('qbalanceanchor qbalancesurface qbalancecategory', {
      limit: 12,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 30_000,
    });
    const supportSourceRuns = facts
      .filter((fact) => fact.memoryKind === 'ui_inventory')
      .map((fact) => fact.sourceRunId);

    expect(supportSourceRuns).toEqual(
      expect.arrayContaining([
        'run-balanced-support-0',
        'run-balanced-support-1',
        'run-balanced-support-2',
      ]),
    );
  });

  it('prefers relevant same-source outcome support over merely adjacent UI support', async () => {
    const corpus = upsertEntity({ name: 'support-relevance-corpus', type: 'concept' });
    const targetSourceRunId = 'run-relevant-outcome-support';
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_procedure',
      objectText: JSON.stringify({
        sourceRunId: targetSourceRunId,
        goal: 'qprimary qworkflow qroot qtarget',
        stepCount: 12,
        steps: [
          { stateIndex: 0, thought: 'qprimary qworkflow qroot' },
          { stateIndex: 11, thought: 'complete workflow' },
        ],
      }),
      sourceRunId: targetSourceRunId,
      memoryKind: 'procedure',
      now: 1_000,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'adjacent_ui',
      objectText: JSON.stringify({
        sourceRunId: targetSourceRunId,
        stateIndex: '0',
        url: 'https://example.test/adjacent',
        controlNames: ['qroot'],
      }),
      sourceRunId: targetSourceRunId,
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 0, url: 'https://example.test/adjacent' },
      now: 2_000,
    });
    const outcome = recordFact({
      subjectId: corpus.id,
      predicate: 'later_outcome',
      objectText: JSON.stringify({
        sourceRunId: targetSourceRunId,
        stateIndex: '9',
        action: 'qtarget qanswer qaction',
        thought: 'qanswer qaction qevidence',
        fields: [{ label: 'qanswer', value: 'qaction' }],
      }),
      sourceRunId: targetSourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 9 },
      now: 3_000,
    });

    for (let index = 0; index < 2; index += 1) {
      const sourceRunId = `run-relevant-outcome-distractor-${index}`;
      recordFact({
        subjectId: corpus.id,
        predicate: `distractor_${index}`,
        objectText: JSON.stringify({
          sourceRunId,
          goal: 'qprimary qworkflow qroot qtarget',
          stepCount: 2,
          steps: [{ stateIndex: 0, thought: 'qprimary qworkflow qroot qtarget' }],
        }),
        sourceRunId,
        memoryKind: 'procedure',
        now: 1_500 + index,
      });
    }

    const facts = await recallFactsForQuery(
      'qprimary qworkflow qroot qtarget qanswer qaction qevidence',
      {
        limit: 4,
        threshold: 0.01,
        candidatePoolLimit: 40,
        now: 5_000,
      },
    );

    expect(facts.map((fact) => fact.id)).toContain(outcome.fact.id);
  });

  it('allows relevant forward action-result support for a selected workflow state', async () => {
    const corpus = upsertEntity({ name: 'action-result-continuation-corpus', type: 'concept' });
    const sourceRunId = 'run-action-result-continuation';
    const selectedState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '1',
        action: 'qtargetscreen qprimaryone qprimarytwo',
        thought: 'qtargetscreen qprimarythree qcontinuation qanswer',
      }),
      sourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 1 },
      retrievability: 0.99,
      importance: 1,
      now: 1_000,
    }).fact;
    const continuation = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '4',
        action: 'qcontinuation qanswer',
        thought: 'qcontinuation qanswer qnextstep',
      }),
      sourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 4 },
      now: 2_000,
    }).fact;
    for (let index = 0; index < 2; index += 1) {
      const distractorRun = `run-action-result-continuation-distractor-${index}`;
      recordFact({
        subjectId: corpus.id,
        predicate: `distractor_${index}`,
        objectText: JSON.stringify({
          sourceRunId: distractorRun,
          stateIndex: '1',
          action: 'qtargetscreen qprimaryone',
          thought: 'qprimarytwo qprimarythree',
        }),
        sourceRunId: distractorRun,
        memoryKind: 'outcome',
        attributes: { stateIndex: 1 },
        now: 900 - index,
      });
    }

    const facts = await recallFactsForQuery(
      'qtargetscreen qprimaryone qprimarytwo qprimarythree qcontinuation qanswer qnextstep',
      {
        limit: 4,
        threshold: 0.01,
        candidatePoolLimit: 40,
        now: 5_000,
      },
    );
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(selectedState.id);
    expect(selectedIds).toContain(continuation.id);
  });

  it('prefers same-state UI schema over duplicate action-result support', async () => {
    const corpus = upsertEntity({ name: 'state-schema-support-corpus', type: 'concept' });
    const sourceRunId = 'run-state-schema-support';
    const primary = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '1',
        action: 'qschemasurface qprimaryone qprimarytwo',
        thought: 'qschemasurface qprimaryone qprimarytwo',
      }),
      sourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 1 },
      retrievability: 0.99,
      importance: 1,
      now: 1_000,
    }).fact;
    const schema = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '4',
        surfaceLabels: ['qschemasurface'],
        fields: [
          {
            label: 'qschemafield',
            role: 'combobox',
            options: ['qschemaoption'],
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4, url: 'https://example.test/schema' },
      retrievability: 0.7,
      now: 2_000,
    }).fact;
    const duplicateActionSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '4',
        action: 'qschemasurface qduplicateaction',
        thought: 'qschemasurface qduplicateaction',
      }),
      sourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 4 },
      retrievability: 0.95,
      importance: 1,
      now: 3_000,
    }).fact;
    for (let index = 0; index < 2; index += 1) {
      const distractorRun = `run-state-schema-distractor-${index}`;
      recordFact({
        subjectId: corpus.id,
        predicate: `distractor_${index}`,
        objectText: JSON.stringify({
          sourceRunId: distractorRun,
          stateIndex: '1',
          action: 'qschemasurface qprimaryone',
          thought: 'qschemasurface qprimarytwo',
        }),
        sourceRunId: distractorRun,
        memoryKind: 'outcome',
        attributes: { stateIndex: 1 },
        now: 900 - index,
      });
    }

    const facts = await recallFactsForQuery('qschemasurface qprimaryone qprimarytwo', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 5_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(primary.id);
    expect(selectedIds).toContain(schema.id);
    expect(selectedIds).not.toContain(duplicateActionSupport.id);
  });

  it('adds a same-source procedure trace for action-result-only workflow recall', async () => {
    const corpus = upsertEntity({ name: 'action-procedure-support-corpus', type: 'concept' });
    const sourceRunId = 'run-action-procedure-support';
    const primary = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        sourceRunId,
        stateIndex: '3',
        action: 'qactionprocedure qprimary qstep',
        thought: 'qactionprocedure qprimary qstep',
      }),
      sourceRunId,
      memoryKind: 'outcome',
      attributes: { stateIndex: 3 },
      retrievability: 0.99,
      importance: 1,
      now: 2_000,
    }).fact;
    const procedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        goal: 'qactionprocedure qworkflow qstep',
        steps: [
          { stateIndex: '1', action: 'open qworkflow' },
          { stateIndex: '2', action: 'choose qstep' },
          { stateIndex: '3', action: 'finish qworkflow' },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      retrievability: 0.7,
      now: 1_500,
    }).fact;
    for (let index = 0; index < 3; index += 1) {
      const distractorRun = `run-action-procedure-distractor-${index}`;
      recordFact({
        subjectId: corpus.id,
        predicate: `distractor_${index}`,
        objectText: JSON.stringify({
          sourceRunId: distractorRun,
          stateIndex: '3',
          action: 'qactionprocedure qprimary',
          thought: `qdistractor-${index}`,
        }),
        sourceRunId: distractorRun,
        memoryKind: 'outcome',
        attributes: { stateIndex: 3 },
        now: 1_000 - index,
      });
    }

    const facts = await recallFactsForQuery('qactionprocedure qprimary qstep', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 5_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds).toContain(primary.id);
    expect(selectedIds).toContain(procedure.id);
  });
});
