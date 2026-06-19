// ---------------------------------------------------------------------------
// Kavi — Tool catalog discovery metrics
// ---------------------------------------------------------------------------

import {
  aggregateAcceptanceMetrics,
  buildPassRateSummary,
  isSummaryPassing,
} from './aggregateResults';
import { evaluateToolCatalogDiscoveryFixture } from './evaluateToolCatalogDiscoveryFixture';
import { TOOL_CATALOG_DISCOVERY_FIXTURES } from './toolCatalogDiscoveryFixtures';
import type { AcceptanceMetricEvaluation } from './types';
import { TOOL_CATALOG_DISCOVERY_MIN_PASS_RATE } from './thresholds';

export async function evaluateToolCatalogDiscoveryMetricOutcomes(): Promise<AcceptanceMetricEvaluation> {
  const outcomes = await Promise.all(
    TOOL_CATALOG_DISCOVERY_FIXTURES.map(evaluateToolCatalogDiscoveryFixture),
  );
  return aggregateAcceptanceMetrics([
    buildPassRateSummary({
      metricId: 'tool-catalog-discovery',
      label: 'Catalog search/describe activates expected tools and decays discovery surface',
      outcomes,
      targetRate: TOOL_CATALOG_DISCOVERY_MIN_PASS_RATE,
      comparator: 'min',
    }),
  ]);
}

export function isToolCatalogDiscoveryMetricsPassing(
  evaluation: AcceptanceMetricEvaluation,
): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}
