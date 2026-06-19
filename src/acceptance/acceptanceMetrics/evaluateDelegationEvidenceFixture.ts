// ---------------------------------------------------------------------------
// Kavi — Delegation evidence fixture evaluator (completion gate)
// ---------------------------------------------------------------------------

import { evaluateCompletionGate } from '../../engine/graph/completionGate';
import { evaluateFalseFinalizeFixture } from './evaluateFalseFinalizeFixture';
import type { DelegationEvidenceFixture } from './delegationEvidenceFixtures';
import type { AcceptanceFixtureOutcome } from './types';

export function evaluateDelegationEvidenceFixture(
  fixture: DelegationEvidenceFixture,
): AcceptanceFixtureOutcome {
  if (fixture.expectation === 'must_auto_complete') {
    const decision = evaluateCompletionGate(fixture.params);
    if (decision.type !== 'auto_complete_goals') {
      const detail =
        decision.type === 'hold'
          ? `expected auto_complete_goals but gate held (${decision.reason})`
          : 'expected auto_complete_goals but gate returned ready';
      return {
        fixtureId: fixture.id,
        passed: false,
        detail,
      };
    }
    if (decision.reason !== 'delegation_evidence_satisfied') {
      return {
        fixtureId: fixture.id,
        passed: false,
        detail: `expected delegation_evidence_satisfied but got ${decision.reason}`,
      };
    }
    const completedGoal = decision.graphEvent.goals.find((goal) => goal.status === 'completed');
    if (!completedGoal) {
      return {
        fixtureId: fixture.id,
        passed: false,
        detail: 'auto_complete_goals did not mark a goal completed',
      };
    }
    return {
      fixtureId: fixture.id,
      passed: true,
      detail: `auto-completed goal ${completedGoal.id}`,
    };
  }

  const outcome = evaluateFalseFinalizeFixture({
    id: fixture.id,
    expectation: fixture.expectation === 'must_hold' ? 'must_hold' : 'must_ready',
    params: fixture.params,
  });

  return {
    fixtureId: fixture.id,
    passed: outcome.passed,
    detail: outcome.detail,
  };
}