// ---------------------------------------------------------------------------
// Kavi — Goal ↔ task ↔ memory unification metrics
// ---------------------------------------------------------------------------

import { aggregateAcceptanceMetrics, buildPassRateSummary, isSummaryPassing } from './aggregateResults';
import { evaluateGoalTaskUnificationFixture } from './evaluateGoalTaskUnificationFixture';
import { GOAL_TASK_UNIFICATION_FIXTURES } from './goalTaskUnificationFixtures';
import type { AcceptanceMetricEvaluation } from './types';
import { GOAL_TASK_UNIFICATION_MIN_PASS_RATE } from './thresholds';

export async function evaluateGoalTaskUnificationMetricOutcomes(): Promise<AcceptanceMetricEvaluation> {
  const outcomes = await Promise.all(
    GOAL_TASK_UNIFICATION_FIXTURES.map((fixture, index) =>
      evaluateGoalTaskUnificationFixture(fixture, 300 + index * 100),
    ),
  );

  return aggregateAcceptanceMetrics([
    buildPassRateSummary({
      metricId: 'goal-task-unification',
      label: 'Active graph goal scopes task_stack title and session recall',
      outcomes,
      targetRate: GOAL_TASK_UNIFICATION_MIN_PASS_RATE,
      comparator: 'min',
    }),
  ]);
}

export function isGoalTaskUnificationMetricsPassing(
  evaluation: AcceptanceMetricEvaluation,
): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}