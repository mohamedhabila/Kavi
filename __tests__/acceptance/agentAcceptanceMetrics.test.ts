import { AGENT_BOOTSTRAP_FIXTURES } from '../../src/acceptance/acceptanceMetrics/agentBootstrapFixtures';
import { evaluateAgentBootstrapFixture } from '../../src/acceptance/acceptanceMetrics/evaluateAgentBootstrapFixture';
import {
  evaluateAgentMetricOutcomes,
  isAgentMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateAgentMetrics';
import { evaluateFalseFinalizeFixture } from '../../src/acceptance/acceptanceMetrics/evaluateFalseFinalizeFixture';
import { FALSE_FINALIZE_FIXTURES } from '../../src/acceptance/acceptanceMetrics/falseFinalizeFixtures';
import { formatAcceptanceMetricEvaluation } from '../../src/acceptance/acceptanceMetrics/formatReport';
import {
  AGENT_BOOTSTRAP_MIN_PASS_RATE,
  FALSE_FINALIZE_MAX_RATE,
} from '../../src/acceptance/acceptanceMetrics/thresholds';

describe('quality agent metrics harness', () => {
  it('meets bootstrap-by-turn-2 and false-finalize thresholds', () => {
    const bootstrapOutcomes = AGENT_BOOTSTRAP_FIXTURES.map(evaluateAgentBootstrapFixture);
    const falseFinalizeOutcomes = FALSE_FINALIZE_FIXTURES.map(evaluateFalseFinalizeFixture);

    const evaluation = evaluateAgentMetricOutcomes({
      bootstrapOutcomes,
      falseFinalizeOutcomes,
      falseFinalizeFixtures: FALSE_FINALIZE_FIXTURES,
    });

    if (!isAgentMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }

    const bootstrapSummary = evaluation.summaries.find(
      (summary) => summary.metricId === 'agent-bootstrap-turn-2',
    );
    const falseFinalizeSummary = evaluation.summaries.find(
      (summary) => summary.metricId === 'agent-false-finalize',
    );

    expect(bootstrapSummary?.passRate).toBeGreaterThanOrEqual(AGENT_BOOTSTRAP_MIN_PASS_RATE);
    expect(falseFinalizeSummary?.passRate).toBeLessThanOrEqual(FALSE_FINALIZE_MAX_RATE);
    expect(evaluation.passed).toBe(true);
  });
});