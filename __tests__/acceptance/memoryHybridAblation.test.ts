jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryHybridAblation } from '../../src/acceptance/memoryHybridAblation';
import {
  MEMORY_HYBRID_ABLATION_CASES,
  MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE,
} from '../../src/acceptance/memoryHybridAblationFixtures';
import { stableHash, stableStringify } from '../../src/acceptance/e2eAgent/e2eTraceRedaction';
import { upsertEntity } from '../../src/services/memory/entities';
import { recordFact } from '../../src/services/memory/facts/mutations';
import { listFacts } from '../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('frozen hybrid memory ablation', () => {
  it('pins the exact public synthetic fixture bytes', () => {
    expect(stableHash(stableStringify(MEMORY_HYBRID_ABLATION_CASES))).toBe(
      MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE,
    );
  });

  it('measures paired retrieval improvements without making downstream-answer claims', async () => {
    await expect(runMemoryHybridAblation()).resolves.toMatchObject({
      schemaVersion: 'memory-hybrid-ablation-report-v1',
      claimClass: 'diagnostic_only',
      downstreamAnswerEvaluated: false,
      caseCount: 5,
      foregroundPromptVisibleCaseCount: 4,
      componentOnlyCaseCount: 1,
      lexicalControl: {
        caseCount: 1,
        identicalSelectionCount: 1,
        lexicalRecallAtOne: 1,
        hybridRecallAtOne: 1,
      },
      foregroundPositiveRetrieval: {
        caseCount: 2,
        lexicalRecallAtOne: 0,
        hybridRecallAtOne: 1,
        hybridRecallGain: 1,
      },
      componentOnly: {
        caseCount: 1,
        lexicalRecallAtOne: 0,
        hybridRecallAtOne: 1,
      },
      diagnosticTarget: {
        minimumHybridRecallGain: 0.2,
        met: true,
        releaseGate: false,
      },
      pollution: {
        hybridCaseCount: 0,
        hybridOnlyRegressionCount: 0,
        lexicalNegativeFalsePositiveCount: 0,
        hybridNegativeFalsePositiveCount: 0,
      },
      families: {
        entity: {
          evidenceClass: 'foreground_prompt_visible',
          caseCount: 1,
          lexicalTargetHitCount: 0,
          hybridTargetHitCount: 1,
        },
        temporal: {
          evidenceClass: 'foreground_prompt_visible',
          caseCount: 1,
          lexicalTargetHitCount: 0,
          hybridTargetHitCount: 1,
        },
        local_semantic: {
          evidenceClass: 'component_only',
          caseCount: 1,
          lexicalTargetHitCount: 0,
          hybridTargetHitCount: 1,
        },
      },
    });
    expect(listFacts()).toEqual([]);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_entities')
        ?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retrieval_events',
      )?.count,
    ).toBe(0);
  });

  it('refuses a nonempty vault without clearing existing user memory', async () => {
    const subject = upsertEntity({ name: 'existing user memory', type: 'concept' });
    const existing = recordFact({
      subjectId: subject.id,
      predicate: 'must_survive',
      objectText: 'user-owned value',
      scope: 'global',
    });

    await expect(runMemoryHybridAblation()).rejects.toThrow('isolated empty evaluation database');
    expect(listFacts().map((fact) => fact.id)).toEqual([existing.fact.id]);
  });
});
