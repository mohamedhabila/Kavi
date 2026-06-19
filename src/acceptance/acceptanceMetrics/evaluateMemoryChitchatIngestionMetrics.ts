// ---------------------------------------------------------------------------
// Kavi — Chitchat memory ingestion metrics
// ---------------------------------------------------------------------------

import { aggregateAcceptanceMetrics, buildPassRateSummary, isSummaryPassing } from './aggregateResults';
import { evaluateMemoryChitchatIngestionFixture } from './evaluateMemoryChitchatIngestionFixture';
import { MEMORY_CHITCHAT_INGESTION_FIXTURES } from './memoryChitchatIngestionFixtures';
import type { AcceptanceMetricEvaluation } from './types';
import { MEMORY_CHITCHAT_INGESTION_MIN_PASS_RATE } from './thresholds';

export async function evaluateMemoryChitchatIngestionMetricOutcomes(): Promise<AcceptanceMetricEvaluation> {
  const outcomes = await Promise.all(
    MEMORY_CHITCHAT_INGESTION_FIXTURES.map((fixture, index) =>
      evaluateMemoryChitchatIngestionFixture(fixture, 200 + index * 100),
    ),
  );

  return aggregateAcceptanceMetrics([
    buildPassRateSummary({
      metricId: 'memory-chitchat-ingestion',
      label: 'Chitchat turn persists episode and scoped focus without memory_remember',
      outcomes,
      targetRate: MEMORY_CHITCHAT_INGESTION_MIN_PASS_RATE,
      comparator: 'min',
    }),
  ]);
}

export function isMemoryChitchatIngestionMetricsPassing(
  evaluation: AcceptanceMetricEvaluation,
): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}