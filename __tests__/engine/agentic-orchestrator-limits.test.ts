// ---------------------------------------------------------------------------
// Tests — Orchestrator iteration limits (MAX_TOOL_ITERATIONS)
// ---------------------------------------------------------------------------

import { MAX_TOOL_ITERATIONS } from '../../src/engine/orchestrator';
import {
  MAX_TOOL_ITERATIONS_OVERRIDE,
  resolveToolIterationBudget,
} from '../../src/engine/orchestrator/constants';

describe('Orchestrator iteration limits', () => {
  it('has a MAX_TOOL_ITERATIONS of 40 for every run', () => {
    expect(MAX_TOOL_ITERATIONS).toBe(40);
  });

  it('accepts only bounded code-owned iteration overrides', () => {
    expect(resolveToolIterationBudget(65, MAX_TOOL_ITERATIONS)).toBe(65);
    expect(resolveToolIterationBudget(0, MAX_TOOL_ITERATIONS)).toBe(MAX_TOOL_ITERATIONS);
    expect(resolveToolIterationBudget(Number.MAX_SAFE_INTEGER, MAX_TOOL_ITERATIONS)).toBe(
      MAX_TOOL_ITERATIONS_OVERRIDE,
    );
  });
});
