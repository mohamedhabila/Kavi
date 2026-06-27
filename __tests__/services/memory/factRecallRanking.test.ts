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
        vectorWeight: 0,
        textWeight: 1,
        threshold: 0.01,
        candidatePoolLimit: 50,
      },
    );

    expect(scored[0].fact.id).toBe(relevant.fact.id);
    expect(scored[0].textScore).toBeGreaterThan(scored[1].textScore);
  });

  it('keeps relevant trajectory neighbors with a retrieved source-run fact', async () => {
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
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_anchor',
      objectText: 'qanchor qshared qtarget',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 5 },
      now: 3_000,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_setup',
      objectText: 'qshared qtarget-setup',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 0 },
      now: 1_999,
    });
    const prior = recordFact({
      subjectId: corpus.id,
      predicate: 'target_prior',
      objectText: 'qshared qtarget-prior',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 1 },
      now: 2_000,
    });
    const nearPrior = recordFact({
      subjectId: corpus.id,
      predicate: 'target_near_prior',
      objectText: 'qanchor qshared qtarget-near-prior',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 4 },
      now: 2_999,
    });
    const next = recordFact({
      subjectId: corpus.id,
      predicate: 'target_next',
      objectText: 'qshared qtarget-next',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 6 },
      now: 3_001,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_next_duplicate',
      objectText: 'qshared qtarget-next-duplicate',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 6 },
      now: 3_002,
    });
    recordFact({
      subjectId: corpus.id,
      predicate: 'target_result',
      objectText: 'qshared qtarget-result',
      sourceRunId: 'run-target',
      attributes: { stateIndex: 7 },
      now: 3_003,
    });

    const facts = await recallFactsForQuery('qanchor qshared', {
      limit: 5,
      vectorWeight: 0,
      textWeight: 1,
      threshold: 0.01,
      candidatePoolLimit: 50,
      now: 4_000,
    });

    expect(next.fact.attributes.stateIndex).toBe(6);
    expect(facts[0].attributes.stateIndex).toBe(5);
    expect(facts.map((fact) => fact.id)).toContain(prior.fact.id);
    expect(facts.map((fact) => fact.id)).not.toContain(nearPrior.fact.id);
    expect(facts.some((fact) => Number(fact.attributes.stateIndex) > 5)).toBe(true);
    expect(facts.map((fact) => Number(fact.attributes.stateIndex))).toEqual([5, 6, 7, 0, 1]);
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
      vectorWeight: 0,
      textWeight: 1,
      threshold: 0.01,
      now: 20_000,
    });

    expect(scored.some((entry) => entry.fact.id === target.fact.id)).toBe(true);
  });

  it('ranks UI inventories on schema state instead of bulk control text', async () => {
    const surface = upsertEntity({ name: 'surface:https://admin.example.test', type: 'project' });
    const commonUnits = Array.from({ length: 30 }, (_, index) => `qcommon${index}`);
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: commonUnits,
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

    const scored = await recallScoredFactsForQuery(
      `${commonUnits.join(' ')} qtargetoption`,
      {
        conversationId: 'conv-ui-ranking-text',
        memoryKind: ['ui_inventory', 'ui_field'],
        limit: 1,
        vectorWeight: 0,
        textWeight: 1,
        threshold: 0.01,
        now: 20_000,
      },
    );

    expect(scored.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
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
      vectorWeight: 0,
      textWeight: 1,
      threshold: 0.01,
      now: 20_000,
    });

    expect(scored[0].fact.id).toBe(target.fact.id);
    expect(scored[0].fact.memoryKind).toBe('ui_affordance');
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
      vectorWeight: 0,
      textWeight: 1,
      threshold: 0.01,
      now: 20_000,
    });

    expect(scored.map((entry) => entry.fact.id)).toContain(target.fact.id);
  });
});
