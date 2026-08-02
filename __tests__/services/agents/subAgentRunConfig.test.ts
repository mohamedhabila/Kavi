import {
  DEFAULT_SUB_AGENT_MAX_ITERATIONS,
  hasExplicitSubAgentMaxIterations,
  MAX_SUB_AGENT_MAX_ITERATIONS,
  normalizeSubAgentMaxIterations,
  resolveSubAgentGraphIterationBudget,
} from '../../../src/services/agents/lifecycle/runConfig';

describe('sub-agent execution budgets', () => {
  it('keeps the default large enough for sustained work while retaining a hard ceiling', () => {
    expect(DEFAULT_SUB_AGENT_MAX_ITERATIONS).toBeGreaterThan(25);
    expect(normalizeSubAgentMaxIterations(undefined)).toBe(DEFAULT_SUB_AGENT_MAX_ITERATIONS);
    expect(normalizeSubAgentMaxIterations(1)).toBe(DEFAULT_SUB_AGENT_MAX_ITERATIONS);
    expect(normalizeSubAgentMaxIterations(Number.MAX_SAFE_INTEGER)).toBe(
      MAX_SUB_AGENT_MAX_ITERATIONS,
    );
  });

  it('reserves a model/tool cycle per action and a final answer turn', () => {
    expect(resolveSubAgentGraphIterationBudget(DEFAULT_SUB_AGENT_MAX_ITERATIONS)).toBe(
      DEFAULT_SUB_AGENT_MAX_ITERATIONS * 2 + 1,
    );
  });

  it('distinguishes an explicit internal cap from the adaptive default', () => {
    expect(hasExplicitSubAgentMaxIterations(undefined)).toBe(false);
    expect(hasExplicitSubAgentMaxIterations(Number.NaN)).toBe(false);
    expect(hasExplicitSubAgentMaxIterations(0)).toBe(false);
    expect(hasExplicitSubAgentMaxIterations(64)).toBe(true);
  });
});
