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

  it('prioritizes support from higher-ranked selected workflows', async () => {
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
        controlNames: ['qsourceanchor', 'qsourceextra'],
        url: 'https://example.test/competitor/result',
        stateIndex: '8',
      }),
      sourceRunId: 'run-support-competitor',
      memoryKind: 'ui_inventory',
      importance: 0,
      attributes: { stateIndex: 8 },
      now: 3_000,
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

  it('does not expand procedure-only memories into UI support slots', async () => {
    const corpus = upsertEntity({ name: 'procedure-support-corpus', type: 'concept' });
    const procedureNoise = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_noise',
      objectText: JSON.stringify({
        sourceRunId: 'run-procedure-noise',
        goal: 'qprocanchor qprocquery',
        steps: [{ stateIndex: '1' }],
      }),
      sourceRunId: 'run-procedure-noise',
      memoryKind: 'procedure',
      importance: 1,
      now: 1_000,
    }).fact;
    recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_noise_ui',
      objectText: JSON.stringify({
        controlNames: ['qprocanchor', 'qprocquery'],
        url: 'https://example.test/noise/start',
        stateIndex: '1',
      }),
      sourceRunId: 'run-procedure-noise',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 1, url: 'https://example.test/noise/start' },
      now: 900,
    });
    const noiseSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_noise_support',
      objectText: JSON.stringify({
        controlNames: ['qprocanchor', 'qprocquery', 'qprocnoise'],
        url: 'https://example.test/noise/result',
        stateIndex: '2',
      }),
      sourceRunId: 'run-procedure-noise',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 2, url: 'https://example.test/noise/result' },
      now: 2_000,
    }).fact;
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_target',
      objectText: JSON.stringify({
        controlNames: ['qprocanchor', 'qproctarget'],
        url: 'https://example.test/target/start',
        stateIndex: '3',
      }),
      sourceRunId: 'run-procedure-target',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 3, url: 'https://example.test/target/start' },
      now: 800,
    }).fact;
    const filler = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_filler',
      objectText: 'qprocanchor qprocfiller',
      sourceRunId: 'run-procedure-filler',
      now: 700,
    }).fact;
    const targetSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_target_support',
      objectText: JSON.stringify({
        controlNames: ['qprocterminal'],
        url: 'https://example.test/target/result',
        stateIndex: '4',
      }),
      sourceRunId: 'run-procedure-target',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 4, url: 'https://example.test/target/result' },
      now: 3_000,
    }).fact;

    const facts = await recallFactsForQuery('qprocanchor qprocquery qproctarget', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds.slice(0, 3)).toEqual(
      expect.arrayContaining([procedureNoise.id, target.id, filler.id]),
    );
    expect(selectedIds).toContain(targetSupport.id);
    expect(selectedIds).not.toContain(noiseSupport.id);
  });

  it('uses the latest support representative for repeated workflow surfaces', async () => {
    const corpus = upsertEntity({ name: 'support-phase-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_primary',
      objectText: JSON.stringify({
        controlNames: ['qphaseanchor', 'qphasetarget'],
        url: 'https://example.test/flow/surface',
        stateIndex: '10',
      }),
      sourceRunId: 'run-support-phase',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 10, url: 'https://example.test/flow/surface' },
      now: 1_000,
    }).fact;
    const fillerA = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_filler_a',
      objectText: 'qphaseanchor qfillera',
      sourceRunId: 'run-support-phase-filler-a',
      now: 900,
    }).fact;
    const fillerB = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_filler_b',
      objectText: 'qphaseanchor qfillerb',
      sourceRunId: 'run-support-phase-filler-b',
      now: 800,
    }).fact;
    const staleSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_support_stale',
      objectText: JSON.stringify({
        controlNames: ['qphaseanchor', 'qphasestale'],
        url: 'https://example.test/flow/surface',
        stateIndex: '11',
      }),
      sourceRunId: 'run-support-phase',
      memoryKind: 'ui_inventory',
      importance: 1,
      attributes: { stateIndex: 11, url: 'https://example.test/flow/surface' },
      now: 2_000,
    }).fact;
    const latestSupport = recordFact({
      subjectId: corpus.id,
      predicate: 'phase_support_latest',
      objectText: JSON.stringify({
        controlNames: ['qphaselatest'],
        url: 'https://example.test/flow/surface',
        stateIndex: '12',
      }),
      sourceRunId: 'run-support-phase',
      memoryKind: 'ui_inventory',
      importance: 0.1,
      attributes: { stateIndex: 12, url: 'https://example.test/flow/surface' },
      now: 3_000,
    }).fact;

    const facts = await recallFactsForQuery('qphaseanchor qphasetarget', {
      limit: 4,
      threshold: 0.01,
      candidatePoolLimit: 40,
      now: 4_000,
    });
    const selectedIds = facts.map((fact) => fact.id);

    expect(selectedIds.slice(0, 3)).toEqual([target.id, fillerA.id, fillerB.id]);
    expect(selectedIds).toContain(latestSupport.id);
    expect(selectedIds).not.toContain(staleSupport.id);
  });
});
