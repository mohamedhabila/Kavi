// ---------------------------------------------------------------------------
// Kavi — Session tool activation metrics
// ---------------------------------------------------------------------------

import { aggregateAcceptanceMetrics, buildPassRateSummary, isSummaryPassing } from './aggregateResults';
import { evaluateSessionToolActivationFixture } from './evaluateSessionToolActivationFixture';
import { SESSION_TOOL_ACTIVATION_FIXTURES } from './sessionToolActivationFixtures';
import type { AcceptanceMetricEvaluation } from './types';
import { SESSION_TOOL_ACTIVATION_MIN_PASS_RATE } from './thresholds';

export async function evaluateSessionToolActivationMetricOutcomes(): Promise<AcceptanceMetricEvaluation> {
  const outcomes = await Promise.all(
    SESSION_TOOL_ACTIVATION_FIXTURES.map(evaluateSessionToolActivationFixture),
  );
  return aggregateAcceptanceMetrics([
    buildPassRateSummary({
      metricId: 'session-tool-activation',
      label: 'Catalog/describe activations persist on tool surface across user turns',
      outcomes,
      targetRate: SESSION_TOOL_ACTIVATION_MIN_PASS_RATE,
      comparator: 'min',
    }),
  ]);
}

export function isSessionToolActivationMetricsPassing(
  evaluation: AcceptanceMetricEvaluation,
): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}