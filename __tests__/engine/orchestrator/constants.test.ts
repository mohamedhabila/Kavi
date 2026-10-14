// ---------------------------------------------------------------------------
// Tests - Orchestrator: Constants
// ---------------------------------------------------------------------------

import { MAX_TOOL_ITERATIONS, MAX_IDENTICAL_TOOL_CALLS } from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Constants', () => {
    it('should have MAX_TOOL_ITERATIONS > 0', () => {
      expect(MAX_TOOL_ITERATIONS).toBeGreaterThan(0);
    });

    it('should have MAX_IDENTICAL_TOOL_CALLS > 0', () => {
      expect(MAX_IDENTICAL_TOOL_CALLS).toBeGreaterThan(0);
    });
  });
});
