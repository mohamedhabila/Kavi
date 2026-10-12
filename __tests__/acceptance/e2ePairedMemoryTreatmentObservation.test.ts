import { buildE2EPairedPublicReport } from '../../src/acceptance/e2eAgent/e2ePairedPublicReport';
import {
  buildPairedRetrievalEvent,
  buildPairedTurnTrace,
  PAIRED_TEST_SOURCE_THREAD_HASH,
} from '../helpers/e2ePairedRunHarness';
import { completedCondition, runtime } from '../helpers/e2ePairedPublicReportHarness';

describe('paired memory treatment observations', () => {
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

  it('accepts complete intra-turn retrieval refreshes after memory changes', () => {
    const firstEvent = buildPairedRetrievalEvent();
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
                firstEvent,
                {
                  ...firstEvent,
                  id: 'retrieval-private-event-refresh',
                },
              ],
            }),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(true);
    expect(report.memoryPairedObservation).toMatchObject({
      status: 'positive_delta',
      pairedScoreDelta: 1,
    });
    expect(report.conditions[1]).toMatchObject({
      metrics: {
        userTurnCount: 1,
        retrieval: {
          turnStatusCounts: { recorded: 1 },
          eventCount: 2,
        },
      },
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
