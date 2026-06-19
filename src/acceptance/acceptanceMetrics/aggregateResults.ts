// ---------------------------------------------------------------------------
// Kavi — Acceptance metric aggregation
// ---------------------------------------------------------------------------

import type { AcceptanceFixtureOutcome, AcceptanceMetricEvaluation, AcceptanceMetricSummary } from './types';

export function buildPassRateSummary(params: {
  metricId: string;
  label: string;
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>;
  targetRate: number;
  comparator: 'min' | 'max';
}): AcceptanceMetricSummary {
  const passed = params.outcomes.filter((outcome) => outcome.passed).length;
  const total = params.outcomes.length;
  const passRate = total > 0 ? passed / total : 0;

  return {
    metricId: params.metricId,
    label: params.label,
    passed,
    total,
    passRate,
    targetRate: params.targetRate,
    comparator: params.comparator,
    outcomes: params.outcomes,
  };
}

export function isSummaryPassing(summary: AcceptanceMetricSummary): boolean {
  return summary.comparator === 'min'
    ? summary.passRate >= summary.targetRate
    : summary.passRate <= summary.targetRate;
}

export function aggregateAcceptanceMetrics(summaries: AcceptanceMetricSummary[]): AcceptanceMetricEvaluation {
  return {
    passed: summaries.every(isSummaryPassing),
    summaries,
  };
}