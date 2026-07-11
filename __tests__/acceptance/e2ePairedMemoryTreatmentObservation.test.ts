import { buildE2EPairedPublicReport } from '../../src/acceptance/e2eAgent/e2ePairedPublicReport';
import type { E2EScenarioTurnTrace } from '../../src/acceptance/e2eAgent/types';
import {
  buildPairedRetrievalEvent,
  buildPairedTurnTrace,
  PAIRED_TEST_SOURCE_THREAD_HASH,
} from '../helpers/e2ePairedRunHarness';
import { completedCondition, runtime } from '../helpers/e2ePairedPublicReportHarness';

describe('paired memory treatment observations', () => {
  it('requires a clean semantic treatment difference for lexical comparisons', () => {
    const semanticProductTurn = (
      outcome: 'applied' | 'deterministic_fallback',
    ): E2EScenarioTurnTrace =>
      buildPairedTurnTrace({
        sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
        instrumentationStatus: 'recorded',
        events: [
          buildPairedRetrievalEvent({
            selector: { mode: 'semantic', outcome },
          }),
        ],
      });
    const valid = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'lexical_baseline', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [semanticProductTurn('applied')],
        }),
      ]),
    );
    expect(valid.memoryPairedObservation.status).toBe('positive_delta');

    const noSemanticApplication = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'lexical_baseline', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({ condition: 'production_auto', rubricPassed: 1, rubricTotal: 1 }),
      ]),
    );
    expect(noSemanticApplication.validForDeltaClaims).toBe(false);
    expect(noSemanticApplication.pairedDelta).toBeNull();
    expect(noSemanticApplication.memoryPairedObservation.status).toBe('invalid_instrumentation');

    const fallback = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'lexical_baseline', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [semanticProductTurn('deterministic_fallback')],
        }),
      ]),
    );
    expect(fallback.validForDeltaClaims).toBe(false);
    expect(fallback.pairedDelta).toBeNull();
    expect(fallback.memoryPairedObservation.status).toBe('invalid_instrumentation');
  });

  it.each(['missing', 'overflow'] as const)(
    'withholds the paired task delta for %s retrieval evidence',
    (instrumentationStatus) => {
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
                instrumentationStatus,
                events: [],
              }),
            ],
          }),
        ]),
      );

      expect(report.validForDeltaClaims).toBe(false);
      expect(report.pairedDelta).toBeNull();
      expect(report.memoryPairedObservation).toEqual({
        status: 'invalid_instrumentation',
        controlCondition: 'memory_off',
        productCondition: 'production_auto',
        pairedScoreDelta: null,
      });
    },
  );

  it('rejects memory delta claims when candidate-stage instrumentation is missing', () => {
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
                buildPairedRetrievalEvent({
                  selector: { mode: 'semantic', outcome: 'applied' },
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
                }),
              ],
            }),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation).toMatchObject({
      status: 'invalid_instrumentation',
      pairedScoreDelta: null,
    });
  });

  it('invalidates memory observations when selected-ID coverage is truncated', () => {
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
                    ...event.counts,
                    candidateFactCount: 2,
                    selectedFactCount: 2,
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
              ],
            }),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(false);
    expect(report.pairedDelta).toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
    expect(report.memoryPairedObservation.pairedScoreDelta).toBeNull();
  });
});
