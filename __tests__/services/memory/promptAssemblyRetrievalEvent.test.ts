jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { recordPromptAssemblyRetrievalEvent } from '../../../src/services/memory/promptAssemblyRetrievalEvent';
import { readRecentMemoryRetrievalEvents } from '../../../src/services/memory/retrievalLog';
import * as retrievalLog from '../../../src/services/memory/retrievalLog';
import type { RetrievalOrchestratorTimings } from '../../../src/services/memory/retrievalOrchestrator';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const NO_EXPANSION = {
  outcome: 'not_requested' as const,
  requestedSourceCount: 0,
  acceptedSourceCount: 0,
  sourceWithEvidenceCount: 0,
  emittedEvidenceCount: 0,
  promptBudgetDroppedCount: 0,
  promptChars: 0,
  durationMs: 0,
};

function retrievalTimings(pinnedCount: number): RetrievalOrchestratorTimings {
  return {
    planMs: 0,
    recallMs: 2,
    markFactsRecalledMs: 0,
    episodesMs: 0,
    totalMs: 2,
    recall: {
      queryChars: 10,
      queryUnitCount: 2,
      candidateCount: 1,
      candidateHitFactCount: 1,
      tokenizeQueryMs: 0,
      candidateFetchMs: 0,
      candidateTermHitsMs: 0,
      unitWeightsMs: 0,
      scoreMs: 0,
      sortMs: 0,
      selectMs: 0,
      totalMs: 2,
      candidateStages: {
        strategy: 'hybrid',
        localSimilarityOutcome: 'not_requested',
        eligibleScanCount: 1,
        pinnedCount,
        exactQuotedCount: 0,
        lexicalCount: 1,
        entityCount: 0,
        temporalCount: 1,
        localSimilarityCount: 0,
        unionCount: 1,
        diversifiedCount: 1,
        unionMs: 1,
      },
    },
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
  jest.restoreAllMocks();
});

describe('prompt assembly retrieval candidate telemetry', () => {
  it('records missing candidate instrumentation as explicitly not requested', async () => {
    await expect(
      recordPromptAssemblyRetrievalEvent({
        query: 'retrieval query',
        sourceThreadId: 'thread-1',
        taskScopePresent: false,
        state: 'completed',
        selectedFactIds: [],
        selectedEpisodeIds: [],
        expansion: NO_EXPANSION,
        createdAt: 1,
      }),
    ).resolves.toMatchObject({ status: 'recorded' });

    expect(readRecentMemoryRetrievalEvents()[0]?.candidates).toEqual({
      strategy: 'not_requested',
      localSimilarityOutcome: 'not_requested',
      eligibleScanCount: 0,
      pinnedCount: 0,
      exactQuotedCount: 0,
      lexicalCount: 0,
      entityCount: 0,
      temporalCount: 0,
      localSimilarityCount: 0,
      unionCount: 0,
      diversifiedCount: 0,
      unionMs: 0,
    });
  });

  it('rejects malformed stage telemetry instead of coercing it into evidence', async () => {
    await expect(
      recordPromptAssemblyRetrievalEvent({
        query: 'retrieval query',
        sourceThreadId: 'thread-1',
        taskScopePresent: false,
        state: 'completed',
        selectedFactIds: [],
        selectedEpisodeIds: [],
        retrievalTimings: retrievalTimings(Number.NaN),
        expansion: NO_EXPANSION,
        createdAt: 1,
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_candidates' });
    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
  });

  it('skips telemetry when opt-out lands during asynchronous fingerprint derivation', async () => {
    const originalFingerprint = retrievalLog.buildMemoryRetrievalQueryFingerprint;
    let releaseFingerprint!: () => void;
    const fingerprintGate = new Promise<void>((resolve) => {
      releaseFingerprint = resolve;
    });
    let fingerprintStarted!: () => void;
    const fingerprintEntered = new Promise<void>((resolve) => {
      fingerprintStarted = resolve;
    });
    jest
      .spyOn(retrievalLog, 'buildMemoryRetrievalQueryFingerprint')
      .mockImplementation(async (query) => {
        fingerprintStarted();
        await fingerprintGate;
        return originalFingerprint(query);
      });

    const pending = recordPromptAssemblyRetrievalEvent({
      query: 'private telemetry race query',
      sourceThreadId: 'thread-race',
      taskScopePresent: false,
      state: 'completed',
      selectedFactIds: ['private-fact-id'],
      selectedEpisodeIds: [],
      expansion: NO_EXPANSION,
      createdAt: 1,
    });
    await fingerprintEntered;
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    releaseFingerprint();

    await expect(pending).resolves.toEqual({ status: 'skipped', code: 'opt_out' });
    expect(readRecentMemoryRetrievalEvents()).toEqual([]);
  });
});
