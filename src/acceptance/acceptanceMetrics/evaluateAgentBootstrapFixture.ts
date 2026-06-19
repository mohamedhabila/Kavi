// ---------------------------------------------------------------------------
// Kavi — Goal bootstrap structural evaluation (graph state only)
// ---------------------------------------------------------------------------

import { resolveGoalBootstrapState } from '../../engine/goals/bootstrap';
import type { AgentBootstrapFixture } from './agentBootstrapFixtures';
import type { AcceptanceFixtureOutcome } from './types';

function hasLiveGoal(fixture: AgentBootstrapFixture, turn: 'turn1Goals' | 'turn2Goals'): boolean {
  return fixture[turn].some(
    (goal) =>
      goal.status === 'active' || goal.status === 'pending' || goal.status === 'blocked',
  );
}

export function evaluateAgentBootstrapFixture(fixture: AgentBootstrapFixture): AcceptanceFixtureOutcome {
  const turn1Bootstrap = resolveGoalBootstrapState(fixture.turn1Goals);
  const turn2Bootstrap = resolveGoalBootstrapState(fixture.turn2Goals);
  const bootstrappedByTurn2 = hasLiveGoal(fixture, 'turn2Goals');

  if (turn1Bootstrap.shouldOfferGoalBootstrap && !bootstrappedByTurn2) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail:
        fixture.turn2Goals.length > 0
          ? 'turn 2 reached with no live goals'
          : 'turn 2 reached with empty goals',
    };
  }

  if (bootstrappedByTurn2 && turn2Bootstrap.shouldOfferGoalBootstrap) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: 'turn 2 goals present but bootstrap still required',
    };
  }

  if (!bootstrappedByTurn2) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: hasLiveGoal(fixture, 'turn1Goals')
        ? 'no live goals at turn 2'
        : 'no goals at turn 2',
    };
  }

  return { fixtureId: fixture.id, passed: true };
}
