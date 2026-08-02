// ---------------------------------------------------------------------------
// Tests — Orchestrator Mode Awareness (MAX_TOOL_ITERATIONS)
// ---------------------------------------------------------------------------

import { MAX_TOOL_ITERATIONS, MAX_TOOL_ITERATIONS_SUPERAGENT } from '../../src/engine/orchestrator';
import {
  MAX_TOOL_ITERATIONS_OVERRIDE,
  resolveToolIterationBudget,
} from '../../src/engine/orchestrator/constants';

describe('Orchestrator iteration limits', () => {
  it('has standard MAX_TOOL_ITERATIONS of 25', () => {
    expect(MAX_TOOL_ITERATIONS).toBe(25);
  });

  it('has elevated MAX_TOOL_ITERATIONS_SUPERAGENT of 40', () => {
    expect(MAX_TOOL_ITERATIONS_SUPERAGENT).toBe(40);
  });

  it('super-agent limit is higher than standard', () => {
    expect(MAX_TOOL_ITERATIONS_SUPERAGENT).toBeGreaterThan(MAX_TOOL_ITERATIONS);
  });

  it('accepts only bounded code-owned iteration overrides', () => {
    expect(resolveToolIterationBudget(65, MAX_TOOL_ITERATIONS_SUPERAGENT)).toBe(65);
    expect(resolveToolIterationBudget(0, MAX_TOOL_ITERATIONS_SUPERAGENT)).toBe(
      MAX_TOOL_ITERATIONS_SUPERAGENT,
    );
    expect(
      resolveToolIterationBudget(Number.MAX_SAFE_INTEGER, MAX_TOOL_ITERATIONS_SUPERAGENT),
    ).toBe(MAX_TOOL_ITERATIONS_OVERRIDE);
  });
});
