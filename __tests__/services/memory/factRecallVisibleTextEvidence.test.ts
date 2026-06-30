jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recallScoredFactsForQuery } from '../../../src/services/memory/factRecall';
import { buildScoredFact } from '../../../src/services/memory/factRecallScoring';
import type { MemoryFact, MemoryFactKind } from '../../../src/services/memory/facts/types';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { countLexicalUnits } from '../../../src/services/memory/ranking/lexical';
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

describe('recallFactsForQuery - visible UI text evidence', () => {
  function scoringFact(params: {
    id: string;
    memoryKind: MemoryFactKind;
    objectText: string;
  }): MemoryFact {
    return {
      id: params.id,
      subjectId: 'subject',
      predicate: params.memoryKind,
      objectText: params.objectText,
      objectEntityId: null,
      confidence: 1,
      importance: 0,
      pinned: false,
      scope: 'global',
      originConversationId: null,
      originThreadId: null,
      originTaskId: null,
      sourceMessageId: null,
      sourceRunId: 'run',
      sourceTurnId: null,
      sourceSummary: null,
      accessCount: 0,
      repeatedMentionCount: 0,
      memoryKind: params.memoryKind,
      attributes: {},
      contentHash: params.id,
      embedding: null,
      decayPolicy: 'normal',
      expiresAt: null,
      createdAt: 1_000,
      updatedAt: 1_000,
      deletedAt: null,
      lastRecalledAt: null,
      lastReinforcedAt: null,
      lastAccessedAt: null,
      sourceActorId: null,
      taskId: null,
      retrievability: 1,
      stability: 0.5,
      decayRate: 0,
      lastPresentedAt: null,
      lastConfirmedAt: null,
      lastConflictedAt: null,
      reviewState: 'fresh',
      sensitivity: 'normal',
      validAt: 1_000,
      invalidAt: null,
    };
  }

  it('keeps raw UI visible text boost below structured action-result evidence', () => {
    const queryUnits = new Set(
      countLexicalUnits('qdelete qrecords qcondition qupdate qworkflow').keys(),
    );
    const unitWeights = new Map(Array.from(queryUnits).map((unit) => [unit, 1]));
    const factUnitHits = new Set(queryUnits);
    const rawUi = buildScoredFact({
      fact: scoringFact({
        id: 'raw-ui',
        memoryKind: 'ui_inventory',
        objectText: JSON.stringify({
          visibleTextSnippets: [{ text: 'qdelete qrecords qcondition qworkflow' }],
        }),
      }),
      queryUnits,
      factUnitHits,
      unitWeights,
      anchorUnitSets: [],
      query: 'qdelete qrecords qcondition qupdate qworkflow',
      alwaysIncludePinned: true,
      options: {},
      now: 2_000,
    });
    const outcome = buildScoredFact({
      fact: scoringFact({
        id: 'outcome',
        memoryKind: 'outcome',
        objectText: JSON.stringify({
          thought: 'qdelete qrecords qcondition qupdate',
          fields: [{ label: 'qcondition', value: 'qupdate' }],
        }),
      }),
      queryUnits,
      factUnitHits,
      unitWeights,
      anchorUnitSets: [],
      query: 'qdelete qrecords qcondition qupdate qworkflow',
      alwaysIncludePinned: true,
      options: {},
      now: 2_000,
    });

    expect(outcome.visibleTextEvidenceBoost).toBeGreaterThan(rawUi.visibleTextEvidenceBoost);
    expect(outcome.score).toBeGreaterThan(rawUi.score);
  });

  it('prioritizes direct visible UI text over an indirect procedure from the same source', async () => {
    const corpus = upsertEntity({ name: 'direct-visible-ui-corpus', type: 'concept' });
    const sourceRunId = 'run-visible-ui-evidence';
    recordFact({
      subjectId: corpus.id,
      predicate: 'procedure_trace',
      objectText: JSON.stringify({
        sourceRunId,
        goal: 'qcontexta qcontextb qcontextc qcontextd qcontexte qcontextf',
        stepCount: 3,
        steps: [
          { stateIndex: 0, thought: 'qcontexta qcontextb qcontextc' },
          { stateIndex: 1, thought: 'qcontextd qcontexte qcontextf' },
        ],
      }),
      sourceRunId,
      memoryKind: 'procedure',
      now: 1_000,
    });
    const directUi = recordFact({
      subjectId: corpus.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        sourceRunId,
        url: 'https://example.test/direct-visible-ui',
        surfaceLabels: ['qsurface'],
        stateIndex: '1',
        visibleTextSnippets: [
          {
            text: 'qvisiblea qvisibleb qvisiblec qvisibled',
            index: 12,
          },
        ],
      }),
      sourceRunId,
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 1, url: 'https://example.test/direct-visible-ui' },
      now: 2_000,
    });

    const scored = await recallScoredFactsForQuery(
      [
        'qcontexta',
        'qcontextb',
        'qcontextc',
        'qcontextd',
        'qcontexte',
        'qcontextf',
        'qvisiblea',
        'qvisibleb',
        'qvisiblec',
        'qvisibled',
      ].join(' '),
      {
        limit: 1,
        threshold: 0,
        candidatePoolLimit: 20,
      },
    );

    expect(scored.map((entry) => entry.fact.id)).toEqual([directUi.fact.id]);
    expect(scored[0].visibleTextEvidenceBoost).toBeGreaterThan(0);
  });

  it('keeps direct visible UI evidence across surface-identity conflicts', async () => {
    const corpus = upsertEntity({ name: 'visible-ui-identity-corpus', type: 'concept' });
    const surfaceMatch = recordFact({
      subjectId: corpus.id,
      predicate: 'surface_match',
      objectText: JSON.stringify({
        sourceRunId: 'run-surface-match',
        url: 'https://example.test/surface-match',
        surfaceLabels: ['qdominantsurface'],
        stateIndex: '0',
        controlNames: ['qdominantsurface'],
      }),
      sourceRunId: 'run-surface-match',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 0, url: 'https://example.test/surface-match' },
      now: 1_000,
    });
    const directUi = recordFact({
      subjectId: corpus.id,
      predicate: 'direct_visible',
      objectText: JSON.stringify({
        sourceRunId: 'run-direct-visible',
        url: 'https://example.test/direct-visible',
        surfaceLabels: ['qunmatchedsurface'],
        stateIndex: '0',
        visibleTextSnippets: [
          {
            text: 'qvisiblea qvisibleb qvisiblec qvisibled',
            index: 8,
          },
        ],
      }),
      sourceRunId: 'run-direct-visible',
      memoryKind: 'ui_inventory',
      attributes: { stateIndex: 0, url: 'https://example.test/direct-visible' },
      now: 2_000,
    });

    const scored = await recallScoredFactsForQuery(
      'qdominantsurface qvisiblea qvisibleb qvisiblec qvisibled',
      {
        limit: 2,
        threshold: 0,
        candidatePoolLimit: 20,
      },
    );

    expect(scored.map((entry) => entry.fact.id)).toEqual(
      expect.arrayContaining([surfaceMatch.fact.id, directUi.fact.id]),
    );
    expect(
      scored.find((entry) => entry.fact.id === directUi.fact.id)?.visibleTextEvidenceBoost,
    ).toBeGreaterThan(0);
  });
});
