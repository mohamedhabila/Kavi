// ---------------------------------------------------------------------------
// Kavi — Goal capability discovery acceptance metrics
// ---------------------------------------------------------------------------

import { aggregateAcceptanceMetrics, buildPassRateSummary, isSummaryPassing } from './aggregateResults';
import { evaluateGoalCapabilityDiscoveryFixture } from './evaluateGoalCapabilityDiscoveryFixture';
import { GOAL_CAPABILITY_DISCOVERY_FIXTURES } from './goalCapabilityDiscoveryFixtures';
import type { AcceptanceMetricEvaluation } from './types';
import { GOAL_CAPABILITY_DISCOVERY_MIN_PASS_RATE } from './thresholds';

export function evaluateGoalCapabilityDiscoveryMetricOutcomes(): AcceptanceMetricEvaluation {
  const outcomes = GOAL_CAPABILITY_DISCOVERY_FIXTURES.map(evaluateGoalCapabilityDiscoveryFixture);
  return aggregateAcceptanceMetrics([
    buildPassRateSummary({
      metricId: 'goal-capability-discovery',
      label: 'Goal requiredCapabilities resolve expected catalog tools',
      outcomes,
      targetRate: GOAL_CAPABILITY_DISCOVERY_MIN_PASS_RATE,
      comparator: 'min',
    }),
  ]);
}

export function isGoalCapabilityDiscoveryMetricsPassing(
  evaluation: AcceptanceMetricEvaluation,
): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}