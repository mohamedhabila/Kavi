import { formatAcceptanceMetricEvaluation } from '../../src/acceptance/acceptanceMetrics/formatReport';
import {
  evaluateSessionToolActivationMetricOutcomes,
  isSessionToolActivationMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateSessionToolActivationMetrics';

describe('session tool activation acceptance metrics', () => {
  it('retains catalog activations across user turns via graph session cache', async () => {
    const evaluation = await evaluateSessionToolActivationMetricOutcomes();

    if (!isSessionToolActivationMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }

    expect(evaluation.passed).toBe(true);
  });
});