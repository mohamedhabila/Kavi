import {
  evaluateAgentMetricOutcomes,
  isAgentMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateAgentMetrics';
import { evaluateFalseFinalizeFixture } from '../../src/acceptance/acceptanceMetrics/evaluateFalseFinalizeFixture';
import { FALSE_FINALIZE_FIXTURES } from '../../src/acceptance/acceptanceMetrics/falseFinalizeFixtures';
import { formatAcceptanceMetricEvaluation } from '../../src/acceptance/acceptanceMetrics/formatReport';
import { FALSE_FINALIZE_MAX_RATE } from '../../src/acceptance/acceptanceMetrics/thresholds';

describe('quality agent metrics harness', () => {
  it('meets the false-finalize threshold', () => {
    const falseFinalizeOutcomes = FALSE_FINALIZE_FIXTURES.map(evaluateFalseFinalizeFixture);

    const evaluation = evaluateAgentMetricOutcomes({
      falseFinalizeOutcomes,
      falseFinalizeFixtures: FALSE_FINALIZE_FIXTURES,
    });

    if (!isAgentMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }

    const falseFinalizeSummary = evaluation.summaries.find(
      (summary) => summary.metricId === 'agent-false-finalize',
    );

    expect(falseFinalizeSummary?.passRate).toBeLessThanOrEqual(FALSE_FINALIZE_MAX_RATE);
    expect(evaluation.passed).toBe(true);
  });
});
