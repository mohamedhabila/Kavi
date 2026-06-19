// ---------------------------------------------------------------------------
// Kavi — Memory acceptance metric evaluation entry point
// ---------------------------------------------------------------------------

import { aggregateAcceptanceMetrics, buildPassRateSummary } from './aggregateResults';
import type { AcceptanceFixtureOutcome, AcceptanceMetricEvaluation } from './types';
import { MEMORY_RECALL_MIN_PASS_RATE } from './thresholds';

export function evaluateMemoryRecallOutcomes(
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>,
): AcceptanceMetricEvaluation {
  const summary = buildPassRateSummary({
    metricId: 'memory-three-turn-recall',
    label: 'Memory: 3-turn interdependent recall',
    outcomes,
    targetRate: MEMORY_RECALL_MIN_PASS_RATE,
    comparator: 'min',
  });

  return aggregateAcceptanceMetrics([summary]);
}