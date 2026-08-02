export const MAX_TOOL_ITERATIONS = 25;
export const MAX_TOOL_ITERATIONS_SUPERAGENT = 40;
// Default long-horizon runs earn this ceiling only through bounded extensions
// backed by recent successful tool outcomes. Explicit caller limits remain
// fixed, and the independent repeat/stagnation detectors still terminate loops.
export const MAX_TOOL_ITERATIONS_OVERRIDE = 512;
export const MAX_IDENTICAL_TOOL_CALLS = 3;

export function resolveToolIterationBudget(
  configured: number | undefined,
  fallback: number,
): number {
  const normalized = Number.isFinite(configured) ? Math.floor(Number(configured)) : 0;
  return normalized > 0 ? Math.min(normalized, MAX_TOOL_ITERATIONS_OVERRIDE) : fallback;
}
