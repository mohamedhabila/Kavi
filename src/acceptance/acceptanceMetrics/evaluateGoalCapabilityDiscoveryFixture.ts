// ---------------------------------------------------------------------------
// Kavi — Goal capability discovery fixture evaluator
// ---------------------------------------------------------------------------

import { resolveGoalCapabilityToolNames } from '../../engine/goals/toolSurface';
import type { AcceptanceFixtureOutcome } from './types';
import type { GoalCapabilityDiscoveryFixture } from './goalCapabilityDiscoveryFixtures';

export function evaluateGoalCapabilityDiscoveryFixture(
  fixture: GoalCapabilityDiscoveryFixture,
): AcceptanceFixtureOutcome {
  const resolved = resolveGoalCapabilityToolNames(fixture.goals, fixture.catalog).sort();
  const expected = [...fixture.expectedToolNames].sort();

  if (resolved.length !== expected.length) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `resolved [${resolved.join(', ')}] expected [${expected.join(', ')}]`,
    };
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (resolved[index] !== expected[index]) {
      return {
        fixtureId: fixture.id,
        passed: false,
        detail: `resolved [${resolved.join(', ')}] expected [${expected.join(', ')}]`,
      };
    }
  }

  return { fixtureId: fixture.id, passed: true };
}