import { formatAcceptanceMetricEvaluation } from '../../src/acceptance/acceptanceMetrics/formatReport';
import {
  evaluateToolCatalogDiscoveryMetricOutcomes,
  isToolCatalogDiscoveryMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateToolCatalogDiscoveryMetrics';

describe('tool catalog discovery acceptance metrics', () => {
  it('activates expected tools after catalog search or describe', async () => {
    const evaluation = await evaluateToolCatalogDiscoveryMetricOutcomes();

    if (!isToolCatalogDiscoveryMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }

    expect(evaluation.passed).toBe(true);
  });
});