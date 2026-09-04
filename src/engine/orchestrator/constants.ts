export const MAX_TOOL_ITERATIONS = 25;
export const MAX_TOOL_ITERATIONS_SUPERAGENT = 40;
// Default long-horizon runs earn this ceiling only through bounded extensions
// backed by recent successful tool outcomes. Explicit caller limits remain
// fixed, and the independent repeat/stagnation detectors still terminate loops.
export const MAX_TOOL_ITERATIONS_OVERRIDE = 512;
export const MAX_IDENTICAL_TOOL_CALLS = 3;

// A foreground interactive run is one where a person is watching the screen
// wait for a reply, as opposed to a delegated worker, a scheduled job, or any
// other background run. Those keep the ceilings above (and the 15-minute
// model-turn inactivity guard); a foreground run is bounded far tighter,
// because an unbroken multi-minute tool-calling grind reads as a hung app,
// not useful background work. When either limit below is reached and the run
// has not finished, the graph forces a text-only "foreground_budget_checkpoint"
// turn (see forcedTextTurn.ts) that reports progress and asks whether to
// continue, and the run ends cleanly rather than as an error.
export const FOREGROUND_MAX_TOOL_ITERATIONS = 12;
export const FOREGROUND_MAX_WALL_CLOCK_MS = 120_000;

export function resolveToolIterationBudget(
  configured: number | undefined,
  fallback: number,
): number {
  const normalized = Number.isFinite(configured) ? Math.floor(Number(configured)) : 0;
  return normalized > 0 ? Math.min(normalized, MAX_TOOL_ITERATIONS_OVERRIDE) : fallback;
}
