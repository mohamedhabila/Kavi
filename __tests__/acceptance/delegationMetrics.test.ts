import { formatAcceptanceMetricEvaluation } from '../../src/acceptance/acceptanceMetrics/formatReport';
import {
  evaluateDelegationMetricOutcomes,
  isDelegationMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateDelegationMetrics';
import { evaluateDelegationEvidenceFixture } from '../../src/acceptance/acceptanceMetrics/evaluateDelegationEvidenceFixture';
import { evaluateDelegationSpawnFixture } from '../../src/acceptance/acceptanceMetrics/evaluateDelegationSpawnFixture';
import { DELEGATION_EVIDENCE_FIXTURES } from '../../src/acceptance/acceptanceMetrics/delegationEvidenceFixtures';
import { DELEGATION_SPAWN_FIXTURES } from '../../src/acceptance/acceptanceMetrics/delegationSpawnFixtures';
import { DELEGATION_SUCCESS_MIN_PASS_RATE } from '../../src/acceptance/acceptanceMetrics/thresholds';

describe('delegation acceptance metrics', () => {
  it('passes all spawn gate fixtures structurally', () => {
    for (const fixture of DELEGATION_SPAWN_FIXTURES) {
      expect(evaluateDelegationSpawnFixture(fixture).passed).toBe(true);
    }
  });

  it('passes all worker evidence gate fixtures structurally', () => {
    for (const fixture of DELEGATION_EVIDENCE_FIXTURES) {
      expect(evaluateDelegationEvidenceFixture(fixture).passed).toBe(true);
    }
  });

  it('meets delegation success pass-rate threshold', () => {
    const evaluation = evaluateDelegationMetricOutcomes();

    if (!isDelegationMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }

    expect(evaluation.passed).toBe(true);
    for (const summary of evaluation.summaries) {
      expect(summary.passRate).toBeGreaterThanOrEqual(DELEGATION_SUCCESS_MIN_PASS_RATE);
    }
  });
});