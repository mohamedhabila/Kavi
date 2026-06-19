import { formatAcceptanceMetricEvaluation } from '../../src/acceptance/acceptanceMetrics/formatReport';
import {
  evaluateGoalCapabilityDiscoveryMetricOutcomes,
  isGoalCapabilityDiscoveryMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateGoalCapabilityDiscoveryMetrics';

describe('goal capability discovery acceptance metrics', () => {
  it('resolves requiredCapabilities to expected tools on fixture catalog', () => {
    const evaluation = evaluateGoalCapabilityDiscoveryMetricOutcomes();

    if (!isGoalCapabilityDiscoveryMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }

    expect(evaluation.passed).toBe(true);
  });
});