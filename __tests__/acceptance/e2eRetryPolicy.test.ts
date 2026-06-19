import { resolveE2EScenarioMaxRetries } from '../../src/acceptance/e2eAgent/e2eRetryPolicy';

describe('e2eRetryPolicy', () => {
  it('resolveE2EScenarioMaxRetries defaults to zero and clamps invalid values', () => {
    expect(resolveE2EScenarioMaxRetries({})).toBe(0);
    expect(resolveE2EScenarioMaxRetries({ E2E_MAX_SCENARIO_RETRIES: '2' })).toBe(2);
    expect(resolveE2EScenarioMaxRetries({ E2E_MAX_SCENARIO_RETRIES: '-1' })).toBe(0);
    expect(resolveE2EScenarioMaxRetries({ E2E_MAX_SCENARIO_RETRIES: '9' })).toBe(3);
  });
});