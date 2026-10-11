import { evaluateDelegationSpawnFixture } from '../../src/acceptance/acceptanceMetrics/evaluateDelegationSpawnFixture';
import { evaluateFalseFinalizeFixture } from '../../src/acceptance/acceptanceMetrics/evaluateFalseFinalizeFixture';
import { DELEGATION_SPAWN_FIXTURES } from '../../src/acceptance/acceptanceMetrics/delegationSpawnFixtures';
import { FALSE_FINALIZE_FIXTURES } from '../../src/acceptance/acceptanceMetrics/falseFinalizeFixtures';

describe('acceptance metric evaluators', () => {
  it('passes all false-finalize fixtures against the completion gate', () => {
    for (const fixture of FALSE_FINALIZE_FIXTURES) {
      expect(evaluateFalseFinalizeFixture(fixture).passed).toBe(true);
    }
  });

  it('passes all delegation spawn fixtures structurally', () => {
    for (const fixture of DELEGATION_SPAWN_FIXTURES) {
      expect(evaluateDelegationSpawnFixture(fixture).passed).toBe(true);
    }
  });

});
