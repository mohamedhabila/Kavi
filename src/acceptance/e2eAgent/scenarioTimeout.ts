// ---------------------------------------------------------------------------
// Kavi — E2E scenario timeout policy
// ---------------------------------------------------------------------------

import {
  E2E_DEFAULT_SCENARIO_TIMEOUT_MS,
  E2E_MAX_SCENARIO_TIMEOUT_MS,
  E2E_PER_USER_TURN_TIMEOUT_MS,
} from './thresholds';
import type { E2EScenario } from './types';

export const E2E_SCENARIO_TIMEOUT_MS_ENV = 'E2E_SCENARIO_TIMEOUT_MS';

function resolveScenarioUserTurnCount(scenario: E2EScenario): number {
  return scenario.userTurns && scenario.userTurns.length > 0 ? scenario.userTurns.length : 1;
}

function resolveConfiguredTimeoutMs(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env[E2E_SCENARIO_TIMEOUT_MS_ENV]?.trim();
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveE2EScenarioTimeoutMs(
  scenario: E2EScenario,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const turnScaledTimeout =
    resolveScenarioUserTurnCount(scenario) * E2E_PER_USER_TURN_TIMEOUT_MS;
  const configuredTimeout = resolveConfiguredTimeoutMs(env);

  return Math.min(
    E2E_MAX_SCENARIO_TIMEOUT_MS,
    Math.max(configuredTimeout ?? E2E_DEFAULT_SCENARIO_TIMEOUT_MS, turnScaledTimeout),
  );
}
