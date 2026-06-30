// ---------------------------------------------------------------------------
// Tests — Query-time fact recall ranking
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  recallFactsForQuery,
  recallScoredFactsForQuery,
} from '../../../src/services/memory/factRecall';
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

describe('recallFactsForQuery — ranking', () => {
  it('weights rare query units above high-frequency overlap', async () => {
    const corpus = upsertEntity({ name: 'idf-corpus', type: 'concept' });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `generic_${index}`,
        objectText: `qcommonone qcommontwo qcommonthree distractor${index}`,
      });
    }
    const relevant = recordFact({
      subjectId: corpus.id,
      predicate: 'target',
      objectText: 'qcommonone qraretoken',
    });

    const scored = await recallScoredFactsForQuery(
      'qcommonone qcommontwo qcommonthree qraretoken',
      {
        limit: 3,
        threshold: 0.01,
        candidatePoolLimit: 50,
      },
    );

    expect(scored[0].fact.id).toBe(relevant.fact.id);
    expect(scored[0].textScore).toBeGreaterThan(scored[1].textScore);
  });

  it('reranks broad candidates with discriminative query evidence', async () => {
    const corpus = upsertEntity({ name: 'discriminative-rerank-corpus', type: 'concept' });
    for (let index = 0; index < 18; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `generic_${index}`,
        objectText: `qformat qanswer qquestion qportal qcurrent qnoise${index}`,
        sourceRunId: `run-generic-${index}`,
        now: 20_000 + index,
      });
    }
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'specific_target',
      objectText: 'qhardware qmodel qcategory qperipheral',
      sourceRunId: 'run-specific-target',
      now: 1_000,
    });

    const scored = await recallScoredFactsForQuery(
      'qformat qanswer qquestion qportal qcurrent qhardware qmodel qcategory qperipheral',
      {
        limit: 4,
        threshold: 0,
        candidatePoolLimit: 40,
      },
    );

    expect(scored[0].fact.id).toBe(target.fact.id);
  });

  it('uses broad indexed query evidence instead of a rare-term-only candidate lane', async () => {
    const corpus = upsertEntity({ name: 'broad-evidence-corpus', type: 'concept' });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `distractor_${index}`,
        objectText: `qrareonly qdistractor${index}`,
      });
    }
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target',
      objectText: 'qadmin qproducts qselected qupdate qfinal qstate',
    });

    const scored = await recallScoredFactsForQuery(
      'qrareonly qadmin qproducts qselected qupdate qfinal qstate',
      {
        limit: 3,
        threshold: 0.01,
        candidatePoolLimit: 20,
      },
    );

    expect(scored[0].fact.id).toBe(target.fact.id);
    expect(scored[0].textScore).toBeGreaterThan(0.8);
  });

  it('diversifies primary recall across source runs before adding duplicate workflow facts', async () => {
    const corpus = upsertEntity({ name: 'source-run-diversity-corpus', type: 'concept' });
    for (let index = 0; index < 4; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `run_a_fact_${index}`,
        objectText: 'qcommonone qcommontwo qcommonthree',
        sourceRunId: 'run-a',
        now: 10 + index,
      });
    }
    const runB = recordFact({
      subjectId: corpus.id,
      predicate: 'run_b_fact',
      objectText: 'qcommonone qcommontwo qcommonthree',
      sourceRunId: 'run-b',
      now: 1,
    });

    const scored = await recallScoredFactsForQuery('qcommonone qcommontwo qcommonthree', {
      limit: 2,
      threshold: 0,
      candidatePoolLimit: 20,
    });

    expect(scored.map((entry) => entry.fact.sourceRunId)).toEqual(['run-a', 'run-b']);
    expect(scored.map((entry) => entry.fact.id)).toContain(runB.fact.id);
  });

  it('does not let action outcomes and workflow summaries from one source consume all primary slots', async () => {
    const corpus = upsertEntity({ name: 'source-run-primary-cap-corpus', type: 'concept' });
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qprimarycap qsharedtoken qactionone',
      sourceRunId: 'run-a',
      memoryKind: 'outcome',
      importance: 1,
      now: 3_000,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: 'qprimarycap qsharedtoken qprocedureone',
      sourceRunId: 'run-a',
      memoryKind: 'procedure',
      importance: 1,
      now: 2_000,
    });
    const runB = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qprimarycap qsharedtoken qactiontwo',
      sourceRunId: 'run-b',
      memoryKind: 'outcome',
      importance: 0.6,
      now: 1_000,
    });

    const scored = await recallScoredFactsForQuery('qprimarycap qsharedtoken', {
      limit: 2,
      threshold: 0.01,
      candidatePoolLimit: 20,
      now: 4_000,
    });

    expect(scored.map((entry) => entry.fact.sourceRunId)).toEqual(['run-a', 'run-b']);
    expect(scored.map((entry) => entry.fact.id)).toContain(runB.fact.id);
  });

  it('scores against selected indexed units instead of absent query noise', async () => {
    const corpus = upsertEntity({ name: 'missing-unit-corpus', type: 'concept' });
    const partial = recordFact({
      subjectId: corpus.id,
      predicate: 'surface_state',
      objectText: 'qavailablecontext',
    });

    const scored = await recallScoredFactsForQuery('qmissingtarget qavailablecontext', {
      limit: 1,
      threshold: 0,
      candidatePoolLimit: 10,
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([partial.fact.id]);
    expect(scored[0].textScore).toBe(1);
  });

  it('keeps quoted anchor units available when scoring-unit selection is saturated', async () => {
    const corpus = upsertEntity({ name: 'quoted-anchor-corpus', type: 'concept' });
    const noiseUnits = Array.from({ length: 20 }, (_, index) => `qverylongnoise${index}`);
    for (const unit of noiseUnits) {
      recordFact({
        subjectId: corpus.id,
        predicate: `noise_${unit}`,
        objectText: unit,
      });
    }
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target',
      objectText: 'qverylongbridge qa qb',
    });

    const scored = await recallScoredFactsForQuery(
      `${noiseUnits.join(' ')} qverylongbridge "qa qb"`,
      {
        limit: 1,
        threshold: 0.01,
        candidatePoolLimit: 80,
      },
    );

    expect(scored.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(scored[0].score).toBeGreaterThan(0.3);
  });

  it('adds adjacent source-run UI observations without pulling distant states', async () => {
    const corpus = upsertEntity({ name: 'trajectory-corpus', type: 'concept' });
    for (let index = 0; index < 8; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `other_${index}`,
        objectText: `qanchor qshared qnoise${index}`,
        sourceRunId: `run-other-${index}`,
        attributes: { stateIndex: index },
        now: 1_000 + index,
      });
    }
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target_anchor',
      objectText: 'qanchor qshared quniqueexact',
      sourceRunId: 'run-target',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 5 },
      now: 3_000,
    });
    const distantSetup = recordFact({
      subjectId: corpus.id,
      predicate: 'target_setup',
      objectText: 'qshared qtarget-setup',
      sourceRunId: 'run-target',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 0 },
      now: 1_999,
    }).fact;
    const distantPrior = recordFact({
      subjectId: corpus.id,
      predicate: 'target_prior',
      objectText: 'qshared qtarget-prior',
      sourceRunId: 'run-target',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 1 },
      now: 2_000,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_near_prior',
      objectText: 'qanchor qshared qtarget-near-prior',
      sourceRunId: 'run-target',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
      now: 2_999,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_next',
      objectText: 'qshared qtarget-next',
      sourceRunId: 'run-target',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 6 },
      now: 3_001,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_next_duplicate',
      objectText: 'qshared qtarget-next-duplicate',
      sourceRunId: 'run-target',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 6 },
      now: 3_002,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_result',
      objectText: 'qshared qtarget-result',
      sourceRunId: 'run-target',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 7 },
      now: 3_003,
    });

    const facts = await recallFactsForQuery('quniqueexact', {
      limit: 5,
      threshold: 0.01,
      candidatePoolLimit: 50,
      now: 4_000,
    });

    expect(facts.map((fact) => fact.id)).toContain(target.fact.id);
    expect(
      facts.some((fact) =>
        ['target_near_prior', 'target_next', 'target_next_duplicate', 'target_result'].includes(
          fact.predicate,
        ),
      ),
    ).toBe(true);
    expect(facts.some((fact) => fact.id === distantSetup.id || fact.id === distantPrior.id)).toBe(
      false,
    );
  });

  it('anchors late discriminative query units before scoped recency fill', async () => {
    const corpus = upsertEntity({ name: 'candidate-coverage-corpus', type: 'concept' });
    const conversationId = 'conv-candidate-coverage';
    const commonUnits = Array.from({ length: 40 }, (_, index) => `qcommon${index}`);
    const query = `${commonUnits.join(' ')} qtargetdeep`;

    for (let index = 0; index < 180; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `recent_${index}`,
        objectText: `qcommon0 qnoise${index}`,
        scope: 'conversation',
        originConversationId: conversationId,
        now: 10_000 + index,
      });
    }

    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target',
      objectText: 'qtargetdeep qcommon0',
      scope: 'conversation',
      originConversationId: conversationId,
      now: 1,
    });

    const scored = await recallScoredFactsForQuery(query, {
      conversationId,
      limit: 5,
      candidatePoolLimit: 120,
      threshold: 0.01,
      now: 20_000,
    });

    expect(scored.some((entry) => entry.fact.id === target.fact.id)).toBe(true);
  });

  it('ranks UI inventories on compact schema state instead of full control object bulk text', async () => {
    const surface = upsertEntity({ name: 'surface:https://admin.example.test', type: 'project' });
    const commonUnits = Array.from({ length: 30 }, (_, index) => `qcommon${index}`);
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controls: commonUnits.map((name) => ({ role: 'button', name })),
        url: 'https://admin.example.test/noisy',
      }),
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-ui-ranking-text',
      now: 10_000,
    });
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        label: 'qtargetlabel',
        role: 'combobox',
        options: ['qtargetoption'],
        url: 'https://admin.example.test/relevant',
      }),
      memoryKind: 'ui_field',
      scope: 'conversation',
      originConversationId: 'conv-ui-ranking-text',
      now: 1,
    });

    const scored = await recallScoredFactsForQuery(`${commonUnits.join(' ')} qtargetoption`, {
      conversationId: 'conv-ui-ranking-text',
      memoryKind: ['ui_inventory', 'ui_field'],
      limit: 1,
      threshold: 0.01,
      now: 20_000,
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
  });

  it('ranks compact popup option facts above noisy page inventories', async () => {
    const surface = upsertEntity({ name: 'surface:https://forum.example.test', type: 'project' });
    const conversationId = 'conv-popup-option-ranking';
    for (let index = 0; index < 40; index += 1) {
      recordFact({
        subjectId: surface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          controlNames: [`qshared${index}`, 'qforum-control'],
          sections: [
            {
              label: `qsection${index}`,
              controlNames: Array.from(
                { length: 24 },
                (_, controlIndex) => `qshared-content-${index}-${controlIndex}`,
              ),
            },
          ],
          url: `https://forum.example.test/noise/${index}`,
        }),
        memoryKind: 'ui_inventory',
        scope: 'conversation',
        originConversationId: conversationId,
        now: 10_000 + index,
      });
    }
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        role: 'button',
        name: 'qsort-current',
        controlName: 'qsort-current',
        options: ['qoption-alpha', 'qoption-beta'],
        url: 'https://forum.example.test/target',
        sourceRunId: 'run-popup-option-ranking',
        stateIndex: '3',
      }),
      memoryKind: 'ui_field',
      scope: 'conversation',
      originConversationId: conversationId,
      sourceRunId: 'run-popup-option-ranking',
      now: 1,
    });

    const scored = await recallScoredFactsForQuery(
      'qforum-control qsort-current qoption-beta',
      {
        conversationId,
        memoryKind: ['ui_inventory', 'ui_field'],
        limit: 1,
        threshold: 0.01,
        now: 20_000,
      },
    );

    expect(scored.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
  });

  it('keeps compact UI state candidates from being crowded out by broad procedures', async () => {
    const surface = upsertEntity({ name: 'surface:https://forum.example.test', type: 'project' });
    const conversationId = 'conv-compact-ui-candidate-lane';
    for (let index = 0; index < 80; index += 1) {
      recordFact({
        subjectId: surface.id,
        predicate: 'procedure_trace',
        objectText: JSON.stringify({
          sourceRunId: `run-noise-${index}`,
          goal: `qshared-context qprocedure-noise-${index}`,
          steps: [{ thought: `qshared-context qprocedure-noise-${index}` }],
        }),
        memoryKind: 'procedure',
        retrievability: 0.25,
        scope: 'conversation',
        originConversationId: conversationId,
        sourceRunId: `run-noise-${index}`,
        now: 10_000 + index,
      });
    }
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_label_value',
      objectText: JSON.stringify({
        label: 'qtarget-label',
        value: 'qtarget-value',
        nearbyTextBefore: ['qshared-context'],
        url: 'https://forum.example.test/thread',
      }),
      memoryKind: 'ui_filter_state',
      retrievability: 0.95,
      scope: 'conversation',
      originConversationId: conversationId,
      sourceRunId: 'run-target-ui-state',
      now: 1,
    });

    const scored = await recallScoredFactsForQuery('qshared-context', {
      conversationId,
      limit: 5,
      threshold: 0.01,
      candidatePoolLimit: 10,
      now: 20_000,
    });

    expect(scored.some((entry) => entry.fact.id === target.fact.id)).toBe(true);
  });

  it('prioritizes first-class UI affordances over recent bulk page state', async () => {
    const surface = upsertEntity({ name: 'surface:https://admin.example.test', type: 'project' });
    const conversationId = 'conv-ui-affordance-priority';
    for (let index = 0; index < 120; index += 1) {
      recordFact({
        subjectId: surface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          fieldLabels: [`qforum${index}`],
          controls: Array.from({ length: 30 }, (_, controlIndex) => ({
            role: 'button',
            name: `qnoise${index}-${controlIndex}`,
          })),
          url: `https://admin.example.test/noise/${index}`,
        }),
        memoryKind: 'ui_inventory',
        scope: 'conversation',
        originConversationId: conversationId,
        now: 10_000 + index,
      });
    }
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_affordance',
      objectText: JSON.stringify({
        role: 'button',
        name: 'qdelete qforum',
        contextLabels: ['qmoderation'],
        url: 'https://admin.example.test/target',
        sourceRunId: 'run-ui-affordance-priority',
        stateIndex: '4',
      }),
      memoryKind: 'ui_affordance',
      scope: 'conversation',
      originConversationId: conversationId,
      sourceRunId: 'run-ui-affordance-priority',
      now: 1,
    });

    const scored = await recallScoredFactsForQuery('qdelete qforum qmoderation', {
      conversationId,
      memoryKind: ['ui_affordance', 'ui_inventory'],
      limit: 3,
      threshold: 0.01,
      now: 20_000,
    });

    expect(scored[0].fact.id).toBe(target.fact.id);
    expect(scored[0].fact.memoryKind).toBe('ui_affordance');
  });

  it('deduplicates procedure traces by source run', async () => {
    const workflow = upsertEntity({ name: 'surface:https://workflow.example.test', type: 'project' });
    recordFact({
      subjectId: workflow.id,
      predicate: 'procedure_trace',
      objectText: 'qdedupeaction',
      memoryKind: 'procedure',
      sourceRunId: 'run-procedure-dedupe',
      now: 1,
    });
    recordFact({
      subjectId: workflow.id,
      predicate: 'procedure_trace',
      objectText: 'qdedupeaction qdedupenext',
      memoryKind: 'procedure',
      sourceRunId: 'run-procedure-dedupe',
      now: 2,
    });

    const facts = await recallFactsForQuery('procedure_trace qdedupeaction qdedupenext', {
      memoryKind: 'procedure',
      limit: 4,
      threshold: 0,
    });

    expect(facts.filter((fact) => fact.sourceRunId === 'run-procedure-dedupe')).toHaveLength(1);
  });

  it('recalls an older relevant UI affordance despite many recent unrelated controls', async () => {
    const surface = upsertEntity({ name: 'surface:https://mobile.example.test', type: 'project' });
    const conversationId = 'conv-ui-affordance-scale';
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_affordance',
      objectText: JSON.stringify({
        role: 'button',
        name: 'qtargetaction',
        contextLabels: ['qtargetsurface'],
        url: 'https://mobile.example.test/target',
        sourceRunId: 'run-ui-affordance-scale',
        stateIndex: '2',
      }),
      memoryKind: 'ui_affordance',
      scope: 'conversation',
      originConversationId: conversationId,
      sourceRunId: 'run-ui-affordance-scale',
      now: 1,
    });
    for (let index = 0; index < 500; index += 1) {
      recordFact({
        subjectId: surface.id,
        predicate: 'ui_affordance',
        objectText: JSON.stringify({
          role: 'button',
          name: `qunrelated${index}`,
          contextLabels: [`qrecent${index}`],
          url: `https://mobile.example.test/recent/${index}`,
        }),
        memoryKind: 'ui_affordance',
        scope: 'conversation',
        originConversationId: conversationId,
        now: 10_000 + index,
      });
    }

    const scored = await recallScoredFactsForQuery('qtargetaction qtargetsurface', {
      conversationId,
      memoryKind: 'ui_affordance',
      limit: 5,
      candidatePoolLimit: 128,
      threshold: 0.01,
      now: 20_000,
    });

    expect(scored.map((entry) => entry.fact.id)).toContain(target.fact.id);
  });
});
