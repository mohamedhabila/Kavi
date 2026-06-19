// ---------------------------------------------------------------------------
// Kavi — Acceptance metric report formatting (harness stderr)
// ---------------------------------------------------------------------------

import type { AcceptanceMetricEvaluation, AcceptanceMetricSummary } from './types';

function formatRate(summary: AcceptanceMetricSummary): string {
  const percent = (summary.passRate * 100).toFixed(1);
  const targetPercent = (summary.targetRate * 100).toFixed(1);
  if (summary.comparator === 'min') {
    return `${percent}% (target ≥ ${targetPercent}%)`;
  }
  return `${percent}% (target ≤ ${targetPercent}%)`;
}

export function formatAcceptanceMetricSummary(summary: AcceptanceMetricSummary): string {
  const resolvedStatus =
    summary.comparator === 'min'
      ? summary.passRate >= summary.targetRate
        ? 'PASS'
        : 'FAIL'
      : summary.passRate <= summary.targetRate
        ? 'PASS'
        : 'FAIL';

  const lines = [
    `[${resolvedStatus}] ${summary.label}: ${summary.passed}/${summary.total} — ${formatRate(summary)}`,
  ];

  const failures = summary.outcomes.filter((outcome) => !outcome.passed);
  for (const failure of failures) {
    lines.push(`  - ${failure.fixtureId}: ${failure.detail ?? 'failed'}`);
  }

  return lines.join('\n');
}

export function formatAcceptanceMetricEvaluation(evaluation: AcceptanceMetricEvaluation): string {
  const header = evaluation.passed
    ? '[acceptance-metrics] All acceptance metric thresholds met.'
    : '[acceptance-metrics] acceptance metric thresholds not met.';
  return [header, ...evaluation.summaries.map(formatAcceptanceMetricSummary)].join('\n');
}