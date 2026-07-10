import {
  beginForegroundScenarioRetrievalCapture,
  completeForegroundScenarioRetrievalCapture,
} from '../../src/acceptance/e2eAgent/foregroundScenarioRetrievalEvidence';
import {
  buildMemoryRetrievalScopeHash,
  readRecentMemoryRetrievalEvents,
} from '../../src/services/memory/retrievalLog';
import type { MemoryRetrievalEvent } from '../../src/services/memory/retrievalEventTypes';

jest.mock('../../src/services/memory/retrievalLog', () => ({
  buildMemoryRetrievalScopeHash: jest.fn(),
  readRecentMemoryRetrievalEvents: jest.fn(),
}));

const mockedBuildMemoryRetrievalScopeHash = jest.mocked(buildMemoryRetrievalScopeHash);
const mockedReadRecentMemoryRetrievalEvents = jest.mocked(readRecentMemoryRetrievalEvents);
const SOURCE_HASH = 'a'.repeat(64);

function event(id: string, createdAt: number): MemoryRetrievalEvent {
  return {
    id,
    operation: 'prompt_assembly',
    mode: 'query',
    outcome: 'completed',
    queryFingerprint: {
      hashAlgorithm: 'sha256',
      hash: 'b'.repeat(64),
      length: 20,
      unitCount: 3,
    },
    scope: {
      memoryConversationIdHash: 'c'.repeat(64),
      sourceThreadIdHash: SOURCE_HASH,
      taskScopePresent: false,
    },
    counts: {
      candidateFactCount: 2,
      selectedFactCount: 1,
      selectedFactIds: ['fact-1'],
      candidateEpisodeCount: 1,
      selectedEpisodeCount: 1,
      selectedEpisodeIds: ['episode-1'],
    },
    timings: {
      planMs: 1,
      factRecallMs: 2,
      episodeRecallMs: 3,
      candidateFetchMs: 1,
      scoreMs: 1,
      selectorMs: 0,
      evidenceExpansionMs: 1,
      totalMs: 5,
    },
    candidates: {
      strategy: 'hybrid',
      localSimilarityOutcome: 'not_requested',
      eligibleScanCount: 2,
      pinnedCount: 0,
      exactQuotedCount: 0,
      lexicalCount: 2,
      entityCount: 0,
      temporalCount: 2,
      localSimilarityCount: 0,
      unionCount: 2,
      diversifiedCount: 2,
      unionMs: 1,
    },
    expansion: {
      outcome: 'completed',
      requestedSourceCount: 2,
      acceptedSourceCount: 2,
      sourceWithEvidenceCount: 1,
      emittedEvidenceCount: 1,
      promptBudgetDroppedCount: 0,
      promptChars: 300,
      durationMs: 1,
    },
    selector: { mode: 'deterministic', outcome: 'not_requested' },
    barrier: { outcome: 'completed', waitMs: 1, queueAgeMs: 2 },
    createdAt,
  };
}

describe('foreground retrieval evidence capture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedBuildMemoryRetrievalScopeHash.mockResolvedValue(SOURCE_HASH);
  });

  it('captures only new scoped events through a closed content-free DTO', async () => {
    const oldEvent = event('old-event', 1);
    const newEvent = {
      ...event('new-event', 2),
      privatePayload: 'PRIVATE-RETRIEVAL-PAYLOAD',
      expansion: {
        ...event('new-event', 2).expansion,
        privatePayload: 'PRIVATE-EXPANSION-PAYLOAD',
      },
      candidates: {
        ...event('new-event', 2).candidates,
        privatePayload: 'PRIVATE-CANDIDATE-PAYLOAD',
      },
    } as MemoryRetrievalEvent;
    mockedReadRecentMemoryRetrievalEvents
      .mockReturnValueOnce([oldEvent])
      .mockReturnValueOnce([newEvent, oldEvent]);

    const capture = await beginForegroundScenarioRetrievalCapture({
      sourceThreadId: 'conversation-1',
      memoryOptOut: false,
    });
    const evidence = completeForegroundScenarioRetrievalCapture({ capture });

    expect(mockedReadRecentMemoryRetrievalEvents).toHaveBeenCalledTimes(2);
    expect(mockedReadRecentMemoryRetrievalEvents).toHaveBeenCalledWith({
      sourceThreadIdHash: SOURCE_HASH,
      operation: 'prompt_assembly',
      limit: 500,
    });
    expect(evidence).toMatchObject({
      sourceThreadIdHash: SOURCE_HASH,
      instrumentationStatus: 'recorded',
      events: [{ id: 'new-event' }],
    });
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE-RETRIEVAL-PAYLOAD');
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE-EXPANSION-PAYLOAD');
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE-CANDIDATE-PAYLOAD');
  });

  it('performs literal zero-access capture for product memory opt-out', async () => {
    const capture = await beginForegroundScenarioRetrievalCapture({
      sourceThreadId: ' not-a-valid-structural-id ',
      memoryOptOut: true,
    });
    expect(completeForegroundScenarioRetrievalCapture({ capture })).toEqual({
      sourceThreadIdHash: null,
      instrumentationStatus: 'opt_out',
      events: [],
    });
    expect(mockedBuildMemoryRetrievalScopeHash).not.toHaveBeenCalled();
    expect(mockedReadRecentMemoryRetrievalEvents).not.toHaveBeenCalled();
  });

  it('marks a full-retention-window result as overflow instead of claiming completeness', async () => {
    const events = Array.from({ length: 500 }, (_, index) => event(`event-${index}`, index));
    mockedReadRecentMemoryRetrievalEvents.mockReturnValueOnce([]).mockReturnValueOnce(events);
    const capture = await beginForegroundScenarioRetrievalCapture({
      sourceThreadId: 'conversation-1',
      memoryOptOut: false,
    });
    const evidence = completeForegroundScenarioRetrievalCapture({ capture });
    expect(evidence.instrumentationStatus).toBe('overflow');
    expect(evidence.events).toHaveLength(500);
  });

  it('marks retention churn as overflow when a captured baseline event is evicted', async () => {
    const baseline = Array.from({ length: 499 }, (_, index) => event(`old-${index}`, index));
    const current = [event('new-1', 500), event('new-2', 501), ...baseline.slice(1)];
    mockedReadRecentMemoryRetrievalEvents
      .mockReturnValueOnce(baseline)
      .mockReturnValueOnce(current);
    const capture = await beginForegroundScenarioRetrievalCapture({
      sourceThreadId: 'conversation-1',
      memoryOptOut: false,
    });
    const evidence = completeForegroundScenarioRetrievalCapture({ capture });
    expect(evidence.instrumentationStatus).toBe('overflow');
    expect(evidence.events.map((entry) => entry.id)).toEqual(['new-1', 'new-2']);
  });
});
