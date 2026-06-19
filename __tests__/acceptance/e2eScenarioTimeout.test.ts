import {
  E2E_SCENARIO_TIMEOUT_MS_ENV,
  resolveE2EScenarioTimeoutMs,
} from '../../src/acceptance/e2eAgent/scenarioTimeout';
import {
  E2E_DEFAULT_SCENARIO_TIMEOUT_MS,
  E2E_MAX_SCENARIO_TIMEOUT_MS,
  E2E_PER_USER_TURN_TIMEOUT_MS,
} from '../../src/acceptance/e2eAgent/thresholds';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';

function makeScenario(overrides: Partial<E2EScenario> = {}): E2EScenario {
  return {
    id: 'timeout-test',
    conversationId: 'conv-timeout-test',
    prompt: 'Run the scenario.',
    rubrics: [],
    ...overrides,
  };
}

describe('resolveE2EScenarioTimeoutMs', () => {
  it('keeps the default timeout for single-turn scenarios', () => {
    expect(resolveE2EScenarioTimeoutMs(makeScenario())).toBe(E2E_DEFAULT_SCENARIO_TIMEOUT_MS);
  });

  it('scales with multi-turn scenario length', () => {
    const scenario = makeScenario({
      userTurns: Array.from({ length: 5 }, (_, index) => ({
        content: `Turn ${index + 1}`,
      })),
    });

    expect(resolveE2EScenarioTimeoutMs(scenario)).toBe(5 * E2E_PER_USER_TURN_TIMEOUT_MS);
  });

  it('caps very long scenarios at the maximum timeout', () => {
    const scenario = makeScenario({
      userTurns: Array.from({ length: 20 }, (_, index) => ({
        content: `Turn ${index + 1}`,
      })),
    });

    expect(resolveE2EScenarioTimeoutMs(scenario)).toBe(E2E_MAX_SCENARIO_TIMEOUT_MS);
  });

  it('allows a configured timeout for slower live providers', () => {
    expect(
      resolveE2EScenarioTimeoutMs(makeScenario(), {
        [E2E_SCENARIO_TIMEOUT_MS_ENV]: '300000',
      } as NodeJS.ProcessEnv),
    ).toBe(300_000);
  });

  it('keeps turn-scaled timeout above the configured default', () => {
    const scenario = makeScenario({
      userTurns: Array.from({ length: 5 }, (_, index) => ({
        content: `Turn ${index + 1}`,
      })),
    });

    expect(
      resolveE2EScenarioTimeoutMs(scenario, {
        [E2E_SCENARIO_TIMEOUT_MS_ENV]: '300000',
      } as NodeJS.ProcessEnv),
    ).toBe(5 * E2E_PER_USER_TURN_TIMEOUT_MS);
  });

  it('caps configured timeouts at the maximum timeout', () => {
    expect(
      resolveE2EScenarioTimeoutMs(makeScenario(), {
        [E2E_SCENARIO_TIMEOUT_MS_ENV]: '900000',
      } as NodeJS.ProcessEnv),
    ).toBe(E2E_MAX_SCENARIO_TIMEOUT_MS);
  });

  it('ignores invalid configured timeout values', () => {
    expect(
      resolveE2EScenarioTimeoutMs(makeScenario(), {
        [E2E_SCENARIO_TIMEOUT_MS_ENV]: 'not-a-number',
      } as NodeJS.ProcessEnv),
    ).toBe(E2E_DEFAULT_SCENARIO_TIMEOUT_MS);
  });

  it('ignores partially numeric configured timeout values', () => {
    expect(
      resolveE2EScenarioTimeoutMs(makeScenario(), {
        [E2E_SCENARIO_TIMEOUT_MS_ENV]: '300000ms',
      } as NodeJS.ProcessEnv),
    ).toBe(E2E_DEFAULT_SCENARIO_TIMEOUT_MS);
  });
});
