// ---------------------------------------------------------------------------
// Tests — Query-time fact recall ranking
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { listFactsForRecallCandidates } from '../../../src/services/memory/facts/queries';
import { recallScoredFactsForQuery } from '../../../src/services/memory/factRecall';
import { countLexicalUnits } from '../../../src/services/memory/ranking/lexical';
import { selectionDedupeKey } from '../../../src/services/memory/ranking/selection';
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

describe('recallFactsForQuery - ranking', () => {
  it('does not dedupe scalar UI state against same-state structural controls', () => {
    const corpus = upsertEntity({ name: 'ui-state-kind-dedupe', type: 'concept' });
    const scalarState = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_label_value',
      objectText: JSON.stringify({
        label: 'qstate-label',
        value: 'qstate-value',
        sourceRunId: 'run-ui-state-kind-dedupe',
        stateIndex: '4',
        url: 'https://app.example.test/state',
      }),
      sourceRunId: 'run-ui-state-kind-dedupe',
      memoryKind: 'ui_filter_state',
      attributes: { stateIndex: 4, url: 'https://app.example.test/state' },
    }).fact;
    const structuralControl = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        role: 'tab',
        options: ['qstate-alpha', 'qstate-beta'],
        sourceRunId: 'run-ui-state-kind-dedupe',
        stateIndex: '4',
        url: 'https://app.example.test/state',
      }),
      sourceRunId: 'run-ui-state-kind-dedupe',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4, url: 'https://app.example.test/state' },
    }).fact;

    expect(selectionDedupeKey(scalarState)).not.toEqual(selectionDedupeKey(structuralControl));
  });

  it('uses structured controls as workflow representatives before scalar state values', async () => {
    const corpus = upsertEntity({ name: 'structured-control-representative', type: 'concept' });
    const conversationId = 'conv-structured-control-representative';
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_label_value',
      objectText: JSON.stringify({
        label: 'qsurface',
        value: 'qscalar',
        sourceRunId: 'run-structured-control-representative',
        stateIndex: '4',
        url: 'https://app.example.test/state',
      }),
      sourceRunId: 'run-structured-control-representative',
      memoryKind: 'ui_filter_state',
      scope: 'conversation',
      originConversationId: conversationId,
      attributes: { stateIndex: 4, url: 'https://app.example.test/state' },
      retrievability: 1,
      now: 1_000,
    });
    const structuralControl = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_popup_options',
      objectText: JSON.stringify({
        role: 'tab',
        controlName: 'qsurface',
        options: ['qpanel-alpha', 'qpanel-beta'],
        sourceRunId: 'run-structured-control-representative',
        stateIndex: '4',
        url: 'https://app.example.test/state',
      }),
      sourceRunId: 'run-structured-control-representative',
      memoryKind: 'ui_field',
      scope: 'conversation',
      originConversationId: conversationId,
      attributes: { stateIndex: 4, url: 'https://app.example.test/state' },
      retrievability: 0.9,
      now: 900,
    });

    const scored = await recallScoredFactsForQuery('qsurface qpanel-beta', {
      conversationId,
      limit: 1,
      threshold: 0.01,
      now: 20_000,
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([structuralControl.fact.id]);
  });

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

  it('reserves candidate space for compact structured UI state', () => {
    const corpus = upsertEntity({ name: 'structured-ui-candidate-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        controlName: 'qcandidatecommon',
        options: ['qcandidatealpha', 'qcandidatebeta'],
        expanded: true,
      }),
      memoryKind: 'ui_field',
      now: 1_000,
    });
    for (let index = 0; index < 20; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `broad_${index}`,
        objectText: `qcandidatecommon qcandidatecommon qcandidatecommon qbulk${index}`,
        memoryKind: 'outcome',
        retrievability: 1,
        now: 2_000 + index,
      });
    }

    const selectedLexicalUnits = Array.from(countLexicalUnits('qcandidatecommon').keys());
    const candidates = listFactsForRecallCandidates({
      selectedLexicalUnits,
      limit: 8,
    });

    expect(candidates.map((fact) => fact.id)).toContain(target.fact.id);
  });

  it('recovers a strongly matching workflow run when compact UI candidates fill the first lane', async () => {
    const corpus = upsertEntity({ name: 'source-run-evidence-seed-corpus', type: 'concept' });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `crowded_ui_${index}`,
        objectText: JSON.stringify({
          controlName: 'qrunseedcommon',
          surfaceLabels: [`qrunseedcrowd${index}`],
        }),
        sourceRunId: `run-crowded-ui-${index}`,
        memoryKind: 'ui_field',
        retrievability: 1,
        now: 3_000 + index,
      });
    }
    const targetProcedure = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: 'qrunseedcommon qrunseedtargeta qrunseedtargetb qrunseedtargetc',
      sourceRunId: 'run-target-workflow',
      memoryKind: 'procedure',
      retrievability: 1,
      now: 1_000,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: 'qrunseedcommon qrunseedtargeta qrunseedtargetb qrunseedtargetc qrunseedfinish',
      sourceRunId: 'run-target-workflow',
      memoryKind: 'outcome',
      retrievability: 1,
      now: 1_100,
    });

    const scored = await recallScoredFactsForQuery(
      'qrunseedcommon qrunseedtargeta qrunseedtargetb qrunseedtargetc qrunseedfinish',
      {
        limit: 3,
        threshold: 0.01,
        candidatePoolLimit: 6,
        now: 4_000,
      },
    );
    const selectedIds = scored.map((entry) => entry.fact.id);

    expect(selectedIds).toContain(targetProcedure.fact.id);
    expect(scored[0].fact.sourceRunId).toBe('run-target-workflow');
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

  it('keeps relevant action evidence when a procedure representative cannot fit', async () => {
    const corpus = upsertEntity({ name: 'procedure-cap-action-fallback-corpus', type: 'concept' });
    const procedureA = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-slot',
        stepCount: 3,
        steps: [
          { stateIndex: '0', action: 'qslotcommon qslotalpha qslotbeta qslotgamma qslotfallback' },
          { stateIndex: '1', action: 'qslotnext' },
          { stateIndex: '2', action: 'qslotfinish' },
        ],
      }),
      sourceRunId: 'run-procedure-slot',
      memoryKind: 'procedure',
      now: 3_000,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-action-fallback',
        stepCount: 3,
        steps: [
          { stateIndex: '0', action: 'qslotcommon qslotalpha qslotbeta qslotgamma qslotfallback' },
          { stateIndex: '1', action: 'qslotnext' },
          { stateIndex: '2', action: 'qslotfinish' },
        ],
      }),
      sourceRunId: 'run-action-fallback',
      memoryKind: 'procedure',
      now: 2_000,
    });
    const outcomeB = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        action: 'qslotfallback',
        thought: 'qslotcommon qslotnext qslotfinish',
      }),
      sourceRunId: 'run-action-fallback',
      memoryKind: 'outcome',
      attributes: { stateIndex: 1 },
      now: 2_100,
    });

    const scored = await recallScoredFactsForQuery(
      'qslotcommon qslotalpha qslotbeta qslotgamma qslotfallback qslotnext qslotfinish',
      {
        limit: 4,
        threshold: 0.01,
        candidatePoolLimit: 20,
        now: 4_000,
      },
    );
    const selectedIds = scored.map((entry) => entry.fact.id);

    expect(selectedIds).toContain(procedureA.fact.id);
    expect(selectedIds).toContain(outcomeB.fact.id);
  });

  it('keeps action outcomes primary instead of replacing them with same-run UI fields', async () => {
    const corpus = upsertEntity({ name: 'action-outcome-primary-corpus', type: 'concept' });
    const outcome = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_action_result',
      objectText: JSON.stringify({
        action: 'qactionprimary',
        thought: 'qactionprimary qactionnext',
      }),
      sourceRunId: 'run-action-primary',
      memoryKind: 'outcome',
      attributes: { stateIndex: 4 },
      now: 2_000,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        controlName: 'qactionprimary',
        value: 'qactionnext',
      }),
      sourceRunId: 'run-action-primary',
      memoryKind: 'ui_field',
      attributes: { stateIndex: 4 },
      now: 1_000,
    });

    const scored = await recallScoredFactsForQuery('qactionprimary qactionnext', {
      limit: 1,
      threshold: 0.01,
      candidatePoolLimit: 20,
      now: 3_000,
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([outcome.fact.id]);
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
});
