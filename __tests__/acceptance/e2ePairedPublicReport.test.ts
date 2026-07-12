import {
  buildE2EPairedPublicReport,
  type E2EPairedPublicReport,
} from '../../src/acceptance/e2eAgent/e2ePairedPublicReport';
import {
  type E2EPairedConditionExecution,
  type E2EPairedRuntimeResult,
} from '../../src/acceptance/e2eAgent/e2ePairedRuntime';
import { stableHash } from '../../src/acceptance/e2eAgent/e2eTraceRedaction';
import {
  buildPairedRetrievalEvent,
  buildPairedTurnTrace,
  PAIRED_TEST_SOURCE_THREAD_HASH,
} from '../helpers/e2ePairedRunHarness';
import {
  completedCondition,
  failedCondition,
  runtime,
} from '../helpers/e2ePairedPublicReportHarness';

function diagnostics(report: E2EPairedPublicReport): string[] {
  return [...report.accidentalSuccessDiagnostics];
}

describe('paired public report projection', () => {
  it('publishes only labels, hashes, counts, metrics, and paired deltas', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({
          condition: 'memory_off',
          rubricPassed: 0,
          rubricTotal: 2,
          estimatedCostUsd: 0.125,
        }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 2,
          rubricTotal: 2,
          durationMs: 125,
          totalTokens: 120,
          estimatedCostUsd: 0.25,
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(true);
    expect(report.pairedDelta).toEqual({
      referenceCondition: 'memory_off',
      candidateCondition: 'production_auto',
      passDelta: 1,
      rubricPassRateDelta: 1,
      executionCompletionDelta: 0,
      totalTokensDelta: 20,
      durationMsDelta: 25,
    });
    expect(report.memoryPairedObservation).toEqual({
      status: 'positive_delta',
      controlCondition: 'memory_off',
      productCondition: 'production_auto',
      pairedScoreDelta: 1,
    });
    expect(report.executionSeed).toBe(2);
    expect(report.executionOrder).toEqual(['memory_off', 'production_auto']);
    expect(report.estimatedCost).toEqual({
      status: 'available',
      referenceUsd: 0.125,
      candidateUsd: 0.25,
      pairUsd: 0.375,
      deltaUsd: 0.125,
    });
    expect(report.pairConfigHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.conditions[0]).toMatchObject({
      condition: 'memory_off',
      status: 'completed',
      metrics: {
        rubricPassed: 0,
        rubricTotal: 2,
        rubricPassRate: 0,
        estimatedCost: { status: 'available', usd: 0.125 },
        publicTraceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
    });

    const serialized = JSON.stringify(report);
    for (const sentinel of [
      'PRIVATE-CONVERSATION-ID',
      'PRIVATE-RUNTIME-ERROR-PROSE',
      'PRIVATE-TOOL-CALL-ID',
      'PRIVATE-TOOL-ARGUMENT',
      'PRIVATE-PAIR-ID',
      'PRIVATE-INVARIANT-CONFIG',
      'systemPrompt',
      'baseUrl',
      'test-key',
      'https://example.com/v1',
      '"oracleEvidence":',
      '"privateError":',
      '"result":',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('reports control-only, diagnostic-only, and forced-route-only accidental successes', () => {
    const controlOnly = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 1, rubricTotal: 1 }),
        completedCondition({ condition: 'production_auto', rubricPassed: 0, rubricTotal: 1 }),
      ]),
    );
    expect(diagnostics(controlOnly)).toEqual(['reference_only_pass', 'control_only_pass']);
    expect(controlOnly.memoryPairedObservation.status).toBe('non_positive_delta');

    const diagnosticOnly = buildE2EPairedPublicReport(
      runtime([
        completedCondition({
          condition: 'diagnostic_full_context',
          rubricPassed: 1,
          rubricTotal: 1,
        }),
        completedCondition({ condition: 'production_auto', rubricPassed: 0, rubricTotal: 1 }),
      ]),
    );
    expect(diagnostics(diagnosticOnly)).toEqual(['reference_only_pass', 'diagnostic_only_pass']);

    const forcedOnly = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'forced_agentic', rubricPassed: 1, rubricTotal: 1 }),
        completedCondition({ condition: 'production_auto', rubricPassed: 0, rubricTotal: 1 }),
      ]),
    );
    expect(diagnostics(forcedOnly)).toEqual(['reference_only_pass', 'forced_route_only_pass']);
  });

  it('publishes infrastructure categories and hashes but no private failure prose', () => {
    const privateRuntime = runtime(
      [
        failedCondition('memory_off'),
        completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
      ],
      {
        cleanup: {
          status: 'failed',
          category: 'state_cleanup',
          errorHash: stableHash('PRIVATE-CLEANUP-ERROR'),
          privateError: 'PRIVATE-CLEANUP-ERROR',
        },
        validForDeltaClaims: false,
      },
    ) as E2EPairedRuntimeResult & {
      invariantConfig?: { systemPrompt: string; provider: { baseUrl: string } };
    };
    privateRuntime.invariantConfig = {
      systemPrompt: 'PRIVATE-SYSTEM-PROMPT',
      provider: { baseUrl: 'https://PRIVATE-HOST.invalid?token=PRIVATE-TOKEN' },
    };
    const report = buildE2EPairedPublicReport(privateRuntime);

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation).toMatchObject({
      status: 'invalid_infrastructure',
      pairedScoreDelta: null,
    });
    expect(report.estimatedCost).toEqual({
      status: 'unavailable',
      referenceUsd: null,
      candidateUsd: null,
      pairUsd: null,
      deltaUsd: null,
    });
    expect(report.infrastructureFailures).toEqual([
      expect.objectContaining({ scope: 'memory_off', category: 'condition_execution' }),
      expect.objectContaining({ scope: 'pair_cleanup', category: 'state_cleanup' }),
    ]);
    const serialized = JSON.stringify(report);
    for (const sentinel of [
      'PRIVATE-INFRASTRUCTURE-ERROR',
      'PRIVATE-CLEANUP-ERROR',
      'PRIVATE-SYSTEM-PROMPT',
      'PRIVATE-HOST',
      'PRIVATE-TOKEN',
      '"privateError":',
      '"invariantConfig":',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('rejects unpaired, duplicate, stale eligibility, and inconsistent assessment evidence', () => {
    const first = completedCondition({
      condition: 'production_auto',
      rubricPassed: 1,
      rubricTotal: 1,
    });
    expect(() => buildE2EPairedPublicReport(runtime([first]))).toThrow(
      'exactly two condition outcomes',
    );
    expect(() => buildE2EPairedPublicReport(runtime([first, first]))).toThrow('must not duplicate');
    expect(() =>
      buildE2EPairedPublicReport(
        runtime([failedCondition('memory_off'), first], { validForDeltaClaims: true }),
      ),
    ).toThrow('delta eligibility is inconsistent');

    const seeded = runtime([
      completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
      completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
    ]);
    expect(() =>
      buildE2EPairedPublicReport({
        ...seeded,
        executionOrder: [...seeded.executionOrder].reverse(),
      }),
    ).toThrow('execution order does not match its seed');
    expect(() =>
      buildE2EPairedPublicReport({
        ...seeded,
        conditions: [
          seeded.conditions[0],
          {
            ...seeded.conditions[1],
            executionIdentityHash: seeded.conditions[0].executionIdentityHash,
          },
        ],
      }),
    ).toThrow('executionIdentityHash is inconsistent');

    const inconsistent = {
      ...first,
      assessment: { ...first.assessment, passed: false },
    } as E2EPairedConditionExecution;
    expect(() =>
      buildE2EPairedPublicReport(
        runtime([
          inconsistent,
          completedCondition({
            condition: 'memory_off',
            rubricPassed: 1,
            rubricTotal: 1,
          }),
        ]),
      ),
    ).toThrow('invalid paired assessment');

    expect(() =>
      buildE2EPairedPublicReport(
        runtime([
          completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 0 }),
          completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
        ]),
      ),
    ).toThrow('invalid paired assessment');

    const event = buildPairedRetrievalEvent();
    expect(() =>
      buildE2EPairedPublicReport(
        runtime([
          completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
          completedCondition({
            condition: 'production_auto',
            rubricPassed: 1,
            rubricTotal: 1,
            userTurnCount: 1,
            turnTraces: [
              buildPairedTurnTrace({
                sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
                instrumentationStatus: 'recorded',
                events: [event],
              }),
              buildPairedTurnTrace({
                sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
                instrumentationStatus: 'recorded',
                events: [{ ...event, id: 'retrieval-private-event-2' }],
              }),
            ],
          }),
        ]),
      ),
    ).toThrow('route evidence exceeds the user-turn count');

    const nonOracleWithEvidence = {
      ...completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
      oracleEvidenceCount: 1,
    } as E2EPairedConditionExecution;
    expect(() =>
      buildE2EPairedPublicReport(
        runtime([
          completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
          nonOracleWithEvidence,
        ]),
      ),
    ).toThrow('production_auto.oracleEvidenceCount is inconsistent');

    for (const oracleEvidenceCount of [0, 33]) {
      const invalidOracle = {
        ...completedCondition({ condition: 'oracle_evidence', rubricPassed: 1, rubricTotal: 1 }),
        oracleEvidenceCount,
      } as E2EPairedConditionExecution;
      expect(() =>
        buildE2EPairedPublicReport(
          runtime([
            invalidOracle,
            completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
          ]),
        ),
      ).toThrow('oracle_evidence.oracleEvidenceCount is inconsistent');
    }
  });

  it('does not make a memory observation from a paired route score', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({ condition: 'forced_agentic', rubricPassed: 1, rubricTotal: 1 }),
      ]),
    );
    expect(report.memoryPairedObservation).toEqual({
      status: 'not_applicable',
      controlCondition: null,
      productCondition: null,
      pairedScoreDelta: null,
    });
  });

  it('does not invert a memory observation when the pair is oriented product to control', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
      ]),
    );
    expect(report.pairedDelta?.referenceCondition).toBe('production_auto');
    expect(report.pairedDelta?.candidateCondition).toBe('memory_off');
    expect(report.memoryPairedObservation).toEqual({
      status: 'not_applicable',
      controlCondition: null,
      productCondition: null,
      pairedScoreDelta: null,
    });
  });

  it('records a positive memory observation for clean memory-off versus production turns', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
      ]),
    );

    expect(report.conditions[0]).toMatchObject({
      metrics: {
        userTurnCount: 1,
        turnTraceIndexCoverage: 'complete',
        routeDirectiveCounts: {
          production_auto: 1,
          forced_chitchat: 0,
          forced_agentic: 0,
        },
        conversationModeCounts: { chitchat: 1, agentic: 0 },
        retrieval: {
          turnStatusCounts: { recorded: 0, missing: 0, optOut: 1, overflow: 0 },
          eventCount: 0,
        },
      },
    });
    expect(report.conditions[1]).toMatchObject({
      metrics: {
        userTurnCount: 1,
        turnTraceIndexCoverage: 'complete',
        routeDirectiveCounts: {
          production_auto: 1,
          forced_chitchat: 0,
          forced_agentic: 0,
        },
        conversationModeCounts: { chitchat: 1, agentic: 0 },
        retrieval: {
          turnStatusCounts: { recorded: 1, missing: 0, optOut: 0, overflow: 0 },
          eventCount: 1,
          modeCounts: { disabled: 0 },
        },
      },
    });
    expect(report.memoryPairedObservation.status).toBe('positive_delta');
  });

  it('invalidates a memory observation when the control uses a forced route', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({
          condition: 'memory_off',
          rubricPassed: 0,
          rubricTotal: 1,
          turnTraces: [
            buildPairedTurnTrace(
              { sourceThreadIdHash: null, instrumentationStatus: 'opt_out', events: [] },
              { route: { directive: 'forced_chitchat', mode: 'chitchat' } },
            ),
          ],
        }),
        completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
    expect(report.conditions[0]).toMatchObject({
      metrics: {
        routeDirectiveCounts: {
          production_auto: 0,
          forced_chitchat: 1,
          forced_agentic: 0,
        },
      },
    });
  });

  it('invalidates memory observations when retrieval traces are absent', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [],
          userTurnCount: 1,
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });

  it('invalidates memory observations when retrieval traces cover only part of the user turns', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [
            buildPairedTurnTrace({
              sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
              instrumentationStatus: 'recorded',
              events: [buildPairedRetrievalEvent()],
            }),
          ],
          userTurnCount: 2,
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });

  it.each([
    ['duplicate', 0],
    ['out-of-range', 2],
  ] as const)(
    'withholds task deltas and invalidates memory observations for %s turn indexes',
    (_label, secondProductTurnIndex) => {
      const firstEvent = buildPairedRetrievalEvent();
      const report = buildE2EPairedPublicReport(
        runtime([
          completedCondition({
            condition: 'memory_off',
            rubricPassed: 0,
            rubricTotal: 1,
            userTurnCount: 2,
            turnTraces: [0, 1].map((turnIndex) =>
              buildPairedTurnTrace(
                { sourceThreadIdHash: null, instrumentationStatus: 'opt_out', events: [] },
                { turnIndex },
              ),
            ),
          }),
          completedCondition({
            condition: 'production_auto',
            rubricPassed: 1,
            rubricTotal: 1,
            userTurnCount: 2,
            turnTraces: [
              buildPairedTurnTrace(
                {
                  sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
                  instrumentationStatus: 'recorded',
                  events: [firstEvent],
                },
                { turnIndex: 0 },
              ),
              buildPairedTurnTrace(
                {
                  sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
                  instrumentationStatus: 'recorded',
                  events: [{ ...firstEvent, id: 'retrieval-private-event-2' }],
                },
                { turnIndex: secondProductTurnIndex },
              ),
            ],
          }),
        ]),
      );

      expect(report.validForDeltaClaims).toBe(false);
      expect(report.pairedDelta).toBeNull();
      expect(report.conditions[1]).toMatchObject({
        metrics: { turnTraceIndexCoverage: 'incomplete' },
      });
      expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
    },
  );

  it('invalidates memory observations when production unexpectedly opts out', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [
            buildPairedTurnTrace({
              sourceThreadIdHash: null,
              instrumentationStatus: 'opt_out',
              events: [],
            }),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });

  it('invalidates memory observations for disabled production retrieval events', () => {
    const event = buildPairedRetrievalEvent();
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [
            buildPairedTurnTrace({
              sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
              instrumentationStatus: 'recorded',
              events: [
                {
                  ...event,
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
                  candidates: {
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
                  },
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
                },
              ],
            }),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });

  it('invalidates memory observations when production selects no facts or episodes', () => {
    const event = buildPairedRetrievalEvent();
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [
            buildPairedTurnTrace({
              sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
              instrumentationStatus: 'recorded',
              events: [
                {
                  ...event,
                  counts: {
                    candidateFactCount: 1,
                    selectedFactCount: 0,
                    selectedFactIds: [],
                    candidateEpisodeCount: 1,
                    selectedEpisodeCount: 0,
                    selectedEpisodeIds: [],
                  },
                },
              ],
            }),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });

  it('invalidates memory observations for degraded production retrieval', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [
            buildPairedTurnTrace({
              sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
              instrumentationStatus: 'recorded',
              events: [buildPairedRetrievalEvent({ outcome: 'degraded' })],
            }),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });
});
