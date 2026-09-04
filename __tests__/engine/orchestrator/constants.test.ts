// ---------------------------------------------------------------------------
// Tests - Orchestrator: Constants
// ---------------------------------------------------------------------------

import { MAX_TOOL_ITERATIONS, MAX_IDENTICAL_TOOL_CALLS } from '../../helpers/orchestratorHarness';
import {
  FOREGROUND_MAX_TOOL_ITERATIONS,
  FOREGROUND_MAX_WALL_CLOCK_MS,
  MAX_TOOL_ITERATIONS_SUPERAGENT,
} from '../../../src/engine/orchestrator/constants';

describe('Orchestrator', () => {
  describe('Constants', () => {
    it('should have MAX_TOOL_ITERATIONS > 0', () => {
      expect(MAX_TOOL_ITERATIONS).toBeGreaterThan(0);
    });

    it('should have MAX_IDENTICAL_TOOL_CALLS > 0', () => {
      expect(MAX_IDENTICAL_TOOL_CALLS).toBeGreaterThan(0);
    });

    it('bounds the foreground interaction budget tighter than every background/delegated ceiling', () => {
      expect(FOREGROUND_MAX_TOOL_ITERATIONS).toBeGreaterThan(0);
      expect(FOREGROUND_MAX_TOOL_ITERATIONS).toBeLessThan(MAX_TOOL_ITERATIONS);
      expect(FOREGROUND_MAX_TOOL_ITERATIONS).toBeLessThan(MAX_TOOL_ITERATIONS_SUPERAGENT);
      expect(FOREGROUND_MAX_WALL_CLOCK_MS).toBeGreaterThan(0);
      // A 12-iteration budget with no wall-clock ceiling could still run for a
      // very long time if each iteration is slow; both limits must hold
      // independently.
      expect(FOREGROUND_MAX_WALL_CLOCK_MS).toBeLessThanOrEqual(5 * 60_000);
    });
  });
});
