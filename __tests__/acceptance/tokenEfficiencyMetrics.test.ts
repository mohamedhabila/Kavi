import { formatAcceptanceMetricEvaluation } from '../../src/acceptance/acceptanceMetrics/formatReport';
import {
  evaluateTokenEfficiencyMetricOutcomes,
  isTokenEfficiencyMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateTokenEfficiencyMetrics';

describe('token efficiency acceptance metrics', () => {
  it('meets tool surface budget, compaction recall, and token reduction thresholds', () => {
    const evaluation = evaluateTokenEfficiencyMetricOutcomes();

    if (!isTokenEfficiencyMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }

    expect(evaluation.passed).toBe(true);
    expect(
      evaluation.summaries.find((summary) => summary.metricId === 'tool-surface-budget')?.passRate,
    ).toBe(1);
    expect(
      evaluation.summaries.find((summary) => summary.metricId === 'compaction-recall')?.passRate,
    ).toBe(1);
    expect(
      evaluation.summaries.find((summary) => summary.metricId === 'tool-definition-token-reduction')
        ?.passed,
    ).toBe(1);
  });
});