// ---------------------------------------------------------------------------
// Kavi — E2E scenario retry policy (operational flake budget)
// ---------------------------------------------------------------------------

import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import { resolveE2EScenarioMaxRetries } from './e2eRetryPolicy';
import { evaluateE2EScenario } from './rubricEvaluators';
import { runE2EScenario } from './scenarioRunner';
import { resetE2EMemorySandbox } from './sandboxMemory';
import { resetE2EWorkspaceSandbox } from './sandboxWorkspace';
import type { E2EScenario, E2EScenarioResult } from './types';

export { E2E_MAX_SCENARIO_RETRIES_ENV, resolveE2EScenarioMaxRetries } from './e2eRetryPolicy';

export type E2EScenarioRunAttempt = {
  result: E2EScenarioResult;
  outcome: AcceptanceFixtureOutcome;
  attemptCount: number;
};

export async function runE2EScenarioWithRetry(
  scenario: E2EScenario,
  options?: { maxRetries?: number },
): Promise<E2EScenarioRunAttempt> {
  const maxRetries = options?.maxRetries ?? resolveE2EScenarioMaxRetries();
  let lastResult!: E2EScenarioResult;
  let lastOutcome!: AcceptanceFixtureOutcome;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      resetE2EWorkspaceSandbox();
      resetE2EMemorySandbox();
    }

    lastResult = await runE2EScenario(scenario);
    lastOutcome = evaluateE2EScenario(lastResult, scenario.rubrics);
    if (lastOutcome.passed) {
      return {
        result: lastResult,
        outcome: lastOutcome,
        attemptCount: attempt + 1,
      };
    }
  }

  return {
    result: lastResult,
    outcome: lastOutcome,
    attemptCount: maxRetries + 1,
  };
}