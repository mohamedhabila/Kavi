import {
  E2E_SCENARIO_TIMEOUT_MS_ENV,
  E2E_TURN_TIMEOUT_MS_ENV,
  resolveE2EScenarioTimeoutMs,
  resolveE2ETurnTimeoutMs,
} from '../../src/acceptance/e2eAgent/scenarioTimeout';
import {
  E2E_DEFAULT_SCENARIO_TIMEOUT_MS,
  E2E_MAX_SCENARIO_TIMEOUT_MS,
  E2E_PER_USER_TURN_TIMEOUT_MS,
} from '../../src/acceptance/e2eAgent/thresholds';
import { DEFAULT_SESSIONS_WAIT_TIMEOUT_MS } from '../../src/engine/tools/builtin-session-waitSupport';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';

function makeScenario(overrides: Partial<E2EScenario> = {}): E2EScenario {
  return {
    id: 'timeout-test',
    conversationId: 'conv-timeout-test',
    contentClass: 'synthetic_public',
    execution: { initialMode: 'agentic', route: 'forced_agentic' },
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

  it('preserves the per-turn deadline for a nine-turn organic conversation', () => {
    const scenario = makeScenario({
      userTurns: Array.from({ length: 9 }, (_, index) => ({
        content: `Turn ${index + 1}`,
      })),
    });

    expect(resolveE2EScenarioTimeoutMs(scenario)).toBe(9 * E2E_PER_USER_TURN_TIMEOUT_MS);
  });

  it('keeps the scenario floor at or above a single turn', () => {
    // A single-turn scenario must never be given less wall clock than the turn it
    // contains, otherwise the default stops being reachable.
    expect(E2E_DEFAULT_SCENARIO_TIMEOUT_MS).toBeGreaterThanOrEqual(E2E_PER_USER_TURN_TIMEOUT_MS);
    expect(E2E_MAX_SCENARIO_TIMEOUT_MS).toBeGreaterThanOrEqual(E2E_DEFAULT_SCENARIO_TIMEOUT_MS);
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
    const configured = E2E_PER_USER_TURN_TIMEOUT_MS + 60_000;
    expect(
      resolveE2EScenarioTimeoutMs(makeScenario(), {
        [E2E_SCENARIO_TIMEOUT_MS_ENV]: String(configured),
      } as NodeJS.ProcessEnv),
    ).toBe(configured);
  });

  it('never gives a single-turn scenario less wall clock than the turn it contains', () => {
    // A configured deadline below the per-turn floor would cut the turn off mid-flight,
    // which is how a legitimately slow turn gets reported as a product failure.
    expect(
      resolveE2EScenarioTimeoutMs(makeScenario(), {
        [E2E_SCENARIO_TIMEOUT_MS_ENV]: String(E2E_PER_USER_TURN_TIMEOUT_MS - 60_000),
      } as NodeJS.ProcessEnv),
    ).toBe(E2E_PER_USER_TURN_TIMEOUT_MS);
  });

  it('gives a delegating turn room for the blocking wait it must accommodate', () => {
    // A turn that delegates blocks for up to the product's `sessions_wait` window while a
    // nested agent run completes, and still needs its own model round-trips either side.
    expect(E2E_PER_USER_TURN_TIMEOUT_MS).toBeGreaterThan(DEFAULT_SESSIONS_WAIT_TIMEOUT_MS);
  });

  it('allows an explicit diagnostic per-turn timeout and scales the scenario deadline', () => {
    const env = {
      [E2E_TURN_TIMEOUT_MS_ENV]: '120000',
    } as NodeJS.ProcessEnv;
    const scenario = makeScenario({
      userTurns: Array.from({ length: 9 }, (_, index) => ({
        content: `Turn ${index + 1}`,
      })),
    });

    expect(resolveE2ETurnTimeoutMs(env)).toBe(120_000);
    expect(resolveE2EScenarioTimeoutMs(scenario, env)).toBe(9 * 120_000);
  });

  it('keeps the score-bearing turn timeout when the diagnostic override is invalid', () => {
    expect(
      resolveE2ETurnTimeoutMs({
        [E2E_TURN_TIMEOUT_MS_ENV]: '120000ms',
      } as NodeJS.ProcessEnv),
    ).toBe(E2E_PER_USER_TURN_TIMEOUT_MS);
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
        // Derived so raising the turn/max thresholds cannot silently stop exercising the cap.
        [E2E_SCENARIO_TIMEOUT_MS_ENV]: String(E2E_MAX_SCENARIO_TIMEOUT_MS + 1_000),
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
