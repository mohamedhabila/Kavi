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
  buildPairedMemoryPromptBuild,
  buildPairedTurnTrace,
  OPTED_OUT_MEMORY_PROMPT,
  recordedMemoryPrompt,
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
      '"privateError":',
      '"result":',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('reports control-only and diagnostic-only accidental successes', () => {
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
  });

  it('withholds task deltas when a condition traces more turns than the user sent', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          userTurnCount: 1,
          turnTraces: [
            buildPairedTurnTrace(recordedMemoryPrompt()),
            buildPairedTurnTrace(recordedMemoryPrompt()),
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
  });

  it('does not make a memory observation from a paired diagnostic score', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'diagnostic_full_context',
          rubricPassed: 1,
          rubricTotal: 1,
        }),
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
        memory: {
          turnStatusCounts: { recorded: 0, missing: 0, optOut: 1 },
          buildCount: 0,
          selectedItemCount: 0,
          selectedPastTurnCount: 0,
        },
      },
    });
    expect(report.conditions[1]).toMatchObject({
      metrics: {
        userTurnCount: 1,
        turnTraceIndexCoverage: 'complete',
        memory: {
          turnStatusCounts: { recorded: 1, missing: 0, optOut: 0 },
          buildCount: 1,
          selectedItemCount: 1,
          selectedPastTurnCount: 1,
          promptChars: 400,
        },
      },
    });
    expect(report.conditions[1]).not.toHaveProperty('metrics.routeDirectiveCounts');
    expect(report.conditions[1]).not.toHaveProperty('metrics.conversationModeCounts');
    expect(report.memoryPairedObservation.status).toBe('positive_delta');
  });

  it('invalidates memory observations when memory evidence is absent', () => {
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

  it('invalidates memory observations when memory evidence covers only part of the user turns', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [buildPairedTurnTrace(recordedMemoryPrompt())],
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
      const report = buildE2EPairedPublicReport(
        runtime([
          completedCondition({
            condition: 'memory_off',
            rubricPassed: 0,
            rubricTotal: 1,
            userTurnCount: 2,
            turnTraces: [0, 1].map((turnIndex) =>
              buildPairedTurnTrace(OPTED_OUT_MEMORY_PROMPT, { turnIndex }),
            ),
          }),
          completedCondition({
            condition: 'production_auto',
            rubricPassed: 1,
            rubricTotal: 1,
            userTurnCount: 2,
            turnTraces: [
              buildPairedTurnTrace(recordedMemoryPrompt(), { turnIndex: 0 }),
              buildPairedTurnTrace(recordedMemoryPrompt(), { turnIndex: secondProductTurnIndex }),
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
          turnTraces: [buildPairedTurnTrace(OPTED_OUT_MEMORY_PROMPT)],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });

  it('invalidates memory observations when production selects no memory', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [
            buildPairedTurnTrace(
              recordedMemoryPrompt([buildPairedMemoryPromptBuild({ itemIds: [], turnIds: [] })]),
            ),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });

  it('invalidates memory observations when a production turn has no recorded memory read', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [buildPairedTurnTrace({ status: 'missing', builds: [] })],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });
});
