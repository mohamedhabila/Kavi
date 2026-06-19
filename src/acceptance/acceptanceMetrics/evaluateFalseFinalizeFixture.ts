// ---------------------------------------------------------------------------
// Kavi — False-finalize structural evaluation via completion gate
// ---------------------------------------------------------------------------

import { evaluateCompletionGate } from '../../engine/graph/completionGate';
import type { FalseFinalizeFixture } from './falseFinalizeFixtures';
import type { AcceptanceFixtureOutcome } from './types';

export function evaluateFalseFinalizeFixture(fixture: FalseFinalizeFixture): AcceptanceFixtureOutcome {
  const decision = evaluateCompletionGate(fixture.params);
  const isReady = decision.type === 'ready';

  if (fixture.expectation === 'must_hold') {
    if (isReady) {
      return {
        fixtureId: fixture.id,
        passed: false,
        detail: 'false finalize: gate returned ready',
      };
    }
    return { fixtureId: fixture.id, passed: true };
  }

  if (!isReady) {
    const reason = decision.type === 'hold' ? decision.reason : 'unknown';
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `expected ready but gate held (${reason})`,
    };
  }

  return { fixtureId: fixture.id, passed: true };
}

export function computeFalseFinalizeRate(
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>,
  fixtures: ReadonlyArray<FalseFinalizeFixture>,
): number {
  const mustHoldIds = new Set(
    fixtures.filter((fixture) => fixture.expectation === 'must_hold').map((fixture) => fixture.id),
  );
  const mustHoldOutcomes = outcomes.filter((outcome) => mustHoldIds.has(outcome.fixtureId));
  if (mustHoldOutcomes.length === 0) {
    return 0;
  }

  const falseFinalizes = mustHoldOutcomes.filter((outcome) => !outcome.passed).length;
  return falseFinalizes / mustHoldOutcomes.length;
}