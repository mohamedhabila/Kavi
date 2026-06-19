// ---------------------------------------------------------------------------
// Kavi — E2E scenario retry policy (env only; no runner imports)
// ---------------------------------------------------------------------------

export const E2E_MAX_SCENARIO_RETRIES_ENV = 'E2E_MAX_SCENARIO_RETRIES';

export function resolveE2EScenarioMaxRetries(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[E2E_MAX_SCENARIO_RETRIES_ENV]?.trim();
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(parsed, 3);
}