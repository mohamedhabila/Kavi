import { buildE2EPairedPublicRetrievalMetrics } from '../../src/acceptance/e2eAgent/e2ePairedPublicRetrievalMetrics';
import {
  buildPairedRetrievalEvent,
  PAIRED_TEST_SOURCE_THREAD_HASH,
} from '../helpers/e2ePairedRunHarness';

type RetrievalTurns = Parameters<typeof buildE2EPairedPublicRetrievalMetrics>[0];

const NOT_REQUESTED_CANDIDATES = {
  strategy: 'not_requested' as const,
  localSemanticOutcome: 'not_requested' as const,
  eligibleScanCount: 0,
  pinnedCount: 0,
  exactQuotedCount: 0,
  lexicalCount: 0,
  entityCount: 0,
  temporalCount: 0,
  localSemanticCount: 0,
  unionCount: 0,
  diversifiedCount: 0,
  unionMs: 0,
};

function recordedTurn(
  events: RetrievalTurns[number]['retrieval']['events'] = [buildPairedRetrievalEvent()],
): RetrievalTurns[number] {
  return {
    retrieval: {
      sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
      instrumentationStatus: 'recorded',
      events,
    },
  };
}

describe('paired public retrieval metrics', () => {
  it('publishes the complete content-free retrieval attribution contract', () => {
    const first = buildPairedRetrievalEvent({
      outcome: 'degraded',
      scope: {
        ...buildPairedRetrievalEvent().scope,
        taskScopePresent: true,
      },
      counts: {
        ...buildPairedRetrievalEvent().counts,
        candidateFactCount: 2,
      },
      candidates: {
        ...buildPairedRetrievalEvent().candidates,
        eligibleScanCount: 2,
        lexicalCount: 2,
        temporalCount: 2,
        unionCount: 2,
        diversifiedCount: 2,
      },
      selector: { mode: 'semantic', outcome: 'deterministic_fallback' },
      barrier: { outcome: 'completed', waitMs: 7, queueAgeMs: 11 },
    });
    const second = buildPairedRetrievalEvent({
      id: 'retrieval-private-event-2',
      mode: 'recent',
      counts: {
        candidateFactCount: 0,
        selectedFactCount: 0,
        selectedFactIds: [],
        candidateEpisodeCount: 0,
        selectedEpisodeCount: 0,
        selectedEpisodeIds: [],
      },
      timings: {
        planMs: 2,
        factRecallMs: 0,
        episodeRecallMs: 0,
        candidateFetchMs: 1,
        scoreMs: 1,
        selectorMs: 2,
        evidenceExpansionMs: 0,
        totalMs: 6,
      },
      candidates: NOT_REQUESTED_CANDIDATES,
      expansion: {
        outcome: 'not_requested',
        requestedSourceCount: 0,
        acceptedSourceCount: 0,
        sourceWithEvidenceCount: 0,
        emittedEvidenceCount: 0,
        promptBudgetDroppedCount: 0,
        promptChars: 0,
        durationMs: 0,
      },
      selector: { mode: 'semantic', outcome: 'applied' },
      barrier: { outcome: 'no_job', waitMs: 0, queueAgeMs: null },
    });
    const disabled = buildPairedRetrievalEvent({
      id: 'retrieval-private-event-3',
      mode: 'disabled',
      outcome: 'disabled',
      counts: {
        candidateFactCount: 0,
        selectedFactCount: 0,
        selectedFactIds: [],
        candidateEpisodeCount: 0,
        selectedEpisodeCount: 0,
        selectedEpisodeIds: [],
      },
      timings: {
        planMs: 0,
        factRecallMs: 0,
        episodeRecallMs: 0,
        candidateFetchMs: 0,
        scoreMs: 0,
        selectorMs: 0,
        evidenceExpansionMs: 0,
        totalMs: 0,
      },
      candidates: NOT_REQUESTED_CANDIDATES,
      expansion: {
        outcome: 'not_requested',
        requestedSourceCount: 0,
        acceptedSourceCount: 0,
        sourceWithEvidenceCount: 0,
        emittedEvidenceCount: 0,
        promptBudgetDroppedCount: 0,
        promptChars: 0,
        durationMs: 0,
      },
      selector: { mode: 'deterministic', outcome: 'not_requested' },
      barrier: null,
    });
    const metrics = buildE2EPairedPublicRetrievalMetrics([
      recordedTurn([first, second, disabled]),
      {
        retrieval: {
          sourceThreadIdHash: null,
          instrumentationStatus: 'opt_out',
          events: [],
        },
      },
      {
        retrieval: {
          sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
          instrumentationStatus: 'missing',
          events: [],
        },
      },
    ]);

    expect(metrics).toEqual({
      turnStatusCounts: { recorded: 1, missing: 1, optOut: 1, overflow: 0 },
      eventCount: 3,
      retrievalFailureCount: 1,
      instrumentationFailureTurnCount: 1,
      candidateFactCount: 2,
      selectedFactCount: 1,
      candidateEpisodeCount: 1,
      selectedEpisodeCount: 1,
      selectedFactIdCoverage: 'complete',
      selectedEpisodeIdCoverage: 'complete',
      selectedFactIdSetHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      selectedEpisodeIdSetHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      modeCounts: { query: 1, recent: 1, disabled: 1 },
      outcomeCounts: { completed: 1, degraded: 1, failed: 0, disabled: 1 },
      selectorCounts: { applied: 1, deterministicFallback: 1, notRequested: 1 },
      candidateStages: {
        strategyCounts: { notRequested: 2, lexical: 0, hybrid: 1 },
        localSemanticOutcomeCounts: { notRequested: 3, unavailable: 0, applied: 0 },
        totals: {
          eligibleScanCount: 2,
          pinnedCount: 0,
          exactQuotedCount: 0,
          lexicalCount: 2,
          entityCount: 0,
          temporalCount: 2,
          localSemanticCount: 0,
          unionCount: 2,
          diversifiedCount: 2,
          unionMs: 1,
        },
        unionMsMax: 1,
      },
      expansionOutcomeCounts: {
        notRequested: 2,
        completed: 1,
        scopeUnavailable: 0,
        failed: 0,
      },
      expansionTotals: {
        requestedSourceCount: 2,
        acceptedSourceCount: 2,
        sourceWithEvidenceCount: 1,
        emittedEvidenceCount: 1,
        promptBudgetDroppedCount: 0,
        promptChars: 400,
        durationMs: 1,
      },
      barrierOutcomeCounts: {
        none: 1,
        noJob: 1,
        completed: 1,
        degraded: 0,
        timedOut: 0,
      },
      barrierWaitMsTotal: 7,
      barrierQueueAgeMsTotal: 11,
      barrierQueueAgeObservedCount: 1,
      taskScopePresentCount: 1,
      timingTotals: {
        planMs: 3,
        factRecallMs: 2,
        episodeRecallMs: 3,
        candidateFetchMs: 2,
        scoreMs: 2,
        selectorMs: 2,
        evidenceExpansionMs: 1,
        totalMs: 11,
      },
    });
    expect(metrics.selectedFactIdSetHash).not.toBe(metrics.selectedEpisodeIdSetHash);
    const serialized = JSON.stringify(metrics);
    for (const sentinel of [
      'retrieval-private-event',
      'private-fact-id',
      'private-episode-id',
      PAIRED_TEST_SOURCE_THREAD_HASH,
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('marks selected-ID hashes as unavailable when stored coverage is truncated', () => {
    const event = buildPairedRetrievalEvent();
    const metrics = buildE2EPairedPublicRetrievalMetrics([
      recordedTurn([
        {
          ...event,
          counts: {
            ...event.counts,
            candidateFactCount: 2,
            selectedFactCount: 2,
            candidateEpisodeCount: 2,
            selectedEpisodeCount: 2,
          },
          candidates: {
            ...event.candidates,
            eligibleScanCount: 2,
            lexicalCount: 2,
            temporalCount: 2,
            unionCount: 2,
            diversifiedCount: 2,
          },
        },
      ]),
    ]);

    expect(metrics).toMatchObject({
      selectedFactCount: 2,
      selectedEpisodeCount: 2,
      selectedFactIdCoverage: 'truncated',
      selectedEpisodeIdCoverage: 'truncated',
      selectedFactIdSetHash: null,
      selectedEpisodeIdSetHash: null,
    });
  });

  it('accepts a zero-event overflow as invalid-but-projectable instrumentation', () => {
    expect(
      buildE2EPairedPublicRetrievalMetrics([
        {
          retrieval: {
            sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
            instrumentationStatus: 'overflow',
            events: [],
          },
        },
      ]),
    ).toMatchObject({
      turnStatusCounts: { recorded: 0, missing: 0, optOut: 0, overflow: 1 },
      eventCount: 0,
      instrumentationFailureTurnCount: 1,
    });
  });

  it('projects unavailable exact scope as valid zero expansion evidence', () => {
    const event = buildPairedRetrievalEvent({
      timings: {
        ...buildPairedRetrievalEvent().timings,
        evidenceExpansionMs: 0,
      },
      expansion: {
        outcome: 'scope_unavailable',
        requestedSourceCount: 2,
        acceptedSourceCount: 0,
        sourceWithEvidenceCount: 0,
        emittedEvidenceCount: 0,
        promptBudgetDroppedCount: 0,
        promptChars: 0,
        durationMs: 0,
      },
    });

    expect(buildE2EPairedPublicRetrievalMetrics([recordedTurn([event])])).toMatchObject({
      retrievalFailureCount: 0,
      expansionOutcomeCounts: { scopeUnavailable: 1 },
      expansionTotals: { requestedSourceCount: 2, emittedEvidenceCount: 0 },
    });
  });

  it('rejects unknown instrumentation and event enums instead of producing NaN counters', () => {
    const unknownStatus = [
      {
        retrieval: {
          sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
          instrumentationStatus: 'unknown',
          events: [],
        },
      },
    ] as unknown as RetrievalTurns;
    expect(() => buildE2EPairedPublicRetrievalMetrics(unknownStatus)).toThrow(
      'retrieval.instrumentationStatus is unsupported',
    );

    const event = buildPairedRetrievalEvent();
    const unknownMode = [recordedTurn([{ ...event, mode: 'unknown' } as unknown as typeof event])];
    expect(() => buildE2EPairedPublicRetrievalMetrics(unknownMode)).toThrow(
      'retrieval.mode is unsupported',
    );
  });

  it('rejects duplicate retrieval event IDs across turns', () => {
    const event = buildPairedRetrievalEvent();
    expect(() =>
      buildE2EPairedPublicRetrievalMetrics([
        recordedTurn([event]),
        recordedTurn([{ ...event, createdAt: event.createdAt + 1 }]),
      ]),
    ).toThrow('must not duplicate event IDs');
  });

  it('rejects negative, non-finite, and unsafe event integers', () => {
    const event = buildPairedRetrievalEvent();
    const invalidEvents = [
      {
        ...event,
        counts: { ...event.counts, candidateFactCount: -1 },
      },
      {
        ...event,
        timings: { ...event.timings, totalMs: Number.NaN },
      },
      { ...event, createdAt: Number.MAX_SAFE_INTEGER + 1 },
    ];

    for (const invalidEvent of invalidEvents) {
      expect(() => buildE2EPairedPublicRetrievalMetrics([recordedTurn([invalidEvent])])).toThrow(
        'bounded non-negative integer',
      );
    }
  });

  it('rejects semantic selector events that never requested semantic selection', () => {
    const event = buildPairedRetrievalEvent({
      selector: { mode: 'semantic', outcome: 'not_requested' },
    });
    expect(() => buildE2EPairedPublicRetrievalMetrics([recordedTurn([event])])).toThrow(
      'selector state is inconsistent',
    );
  });

  it('enforces the disabled-event zero-state invariant', () => {
    const event = buildPairedRetrievalEvent({
      mode: 'disabled',
      outcome: 'disabled',
      selector: { mode: 'deterministic', outcome: 'not_requested' },
    });
    expect(() => buildE2EPairedPublicRetrievalMetrics([recordedTurn([event])])).toThrow(
      'disabled-event state is inconsistent',
    );
  });

  it('rejects inconsistent expansion evidence and excludes open-ended fields', () => {
    const event = buildPairedRetrievalEvent();
    expect(() =>
      buildE2EPairedPublicRetrievalMetrics([
        recordedTurn([
          {
            ...event,
            expansion: { ...event.expansion, sourceWithEvidenceCount: 0 },
          },
        ]),
      ]),
    ).toThrow('expansion state is inconsistent');

    expect(() =>
      buildE2EPairedPublicRetrievalMetrics([
        recordedTurn([
          {
            ...event,
            expansion: {
              outcome: 'failed',
              requestedSourceCount: 1,
              acceptedSourceCount: 0,
              sourceWithEvidenceCount: 0,
              emittedEvidenceCount: 0,
              promptBudgetDroppedCount: 0,
              promptChars: 0,
              durationMs: event.timings.evidenceExpansionMs,
            },
          },
        ]),
      ]),
    ).toThrow('expansion state is inconsistent');

    const metrics = buildE2EPairedPublicRetrievalMetrics([
      recordedTurn([
        {
          ...event,
          expansion: { ...event.expansion, privatePayload: 'PRIVATE EXPANSION PAYLOAD' },
        } as typeof event,
      ]),
    ]);
    expect(JSON.stringify(metrics)).not.toContain('PRIVATE EXPANSION PAYLOAD');
  });

  it('rejects malformed candidate stages and excludes open-ended candidate fields', () => {
    const event = buildPairedRetrievalEvent();
    const malformed = [
      {
        ...event,
        candidates: { ...event.candidates, strategy: 'private_strategy' },
      },
      {
        ...event,
        candidates: { ...event.candidates, pinnedCount: 65 },
      },
      {
        ...event,
        candidates: { ...event.candidates, unionMs: event.timings.factRecallMs + 1 },
      },
      {
        ...event,
        candidates: { ...NOT_REQUESTED_CANDIDATES, lexicalCount: 1 },
      },
    ];
    for (const invalidEvent of malformed) {
      expect(() =>
        buildE2EPairedPublicRetrievalMetrics([
          recordedTurn([invalidEvent as unknown as typeof event]),
        ]),
      ).toThrow(/candidate/u);
    }

    expect(() =>
      buildE2EPairedPublicRetrievalMetrics([
        recordedTurn([
          {
            ...event,
            candidates: {
              ...event.candidates,
              privatePayload: 'PRIVATE CANDIDATE PAYLOAD',
            },
          } as typeof event,
        ]),
      ]),
    ).toThrow('closed candidate-stage fields');
  });
});
