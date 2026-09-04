// ---------------------------------------------------------------------------
// Kavi — Foreground Interaction Budget
// ---------------------------------------------------------------------------
// A person waiting on the screen reads an unbroken multi-minute tool-calling
// grind as a hung app, not useful background work. A foreground interactive
// run is therefore bounded far tighter than a delegated worker or a
// scheduled/background run: those keep the full persona-scoped iteration
// ceilings in orchestrator/constants.ts (MAX_TOOL_ITERATIONS /
// MAX_TOOL_ITERATIONS_SUPERAGENT, extendable up to MAX_TOOL_ITERATIONS_OVERRIDE)
// and the 15-minute model-turn inactivity guard.
//
// This module is pure and code-owned: it never inspects model output or
// claimed progress, so it fires deterministically on iteration count and
// wall-clock elapsed time. When it fires, the caller forces a text-only
// "foreground_budget_checkpoint" turn (see ../forcedTextTurn.ts and
// AgentRunControlGraphForcedTextReason in ../../../types/agentRun.ts) that
// reports progress and asks whether to continue, and the run ends as a clean,
// resumable turn rather than an error or a silent background continuation.
// ---------------------------------------------------------------------------

import {
  FOREGROUND_MAX_TOOL_ITERATIONS,
  FOREGROUND_MAX_WALL_CLOCK_MS,
} from '../../orchestrator/constants';

export type ForegroundInteractionBudgetCheckpointReason =
  | 'foreground_iteration_limit'
  | 'foreground_wall_clock_limit';

export interface ForegroundInteractionBudgetCheckpointDecision {
  readonly shouldCheckpoint: boolean;
  readonly reason?: ForegroundInteractionBudgetCheckpointReason;
}

const NO_CHECKPOINT: ForegroundInteractionBudgetCheckpointDecision = Object.freeze({
  shouldCheckpoint: false,
});

/**
 * Evaluate whether the current iteration of a run has exhausted the
 * foreground interaction budget and must be forced into a text-only
 * checkpoint turn instead of continuing to call tools.
 *
 * Delegated workers, scheduled jobs, and any other background run must pass
 * `isForegroundRun: false` (or omit it): this function always returns
 * `shouldCheckpoint: false` for them, regardless of iteration count or
 * elapsed time, so long-horizon extensions keep working uninterrupted.
 *
 * `iteration` and `elapsedMs` are expected to be code-owned counters from the
 * run loop (the current iteration number, and milliseconds since the run
 * started) — never values derived from model output.
 */
export function evaluateForegroundInteractionBudgetCheckpoint(params: {
  isForegroundRun: boolean;
  iteration: number;
  elapsedMs: number;
  /**
   * True once this run has already been checkpointed. A foreground run only
   * ever checkpoints once per turn boundary; after the checkpoint turn is
   * delivered the run ends, so the caller should not need to re-arm this
   * within a single execution, but the flag exists so a caller composing
   * this with retry/resume logic cannot double-fire it.
   */
  alreadyCheckpointedThisRun?: boolean;
}): ForegroundInteractionBudgetCheckpointDecision {
  if (!params.isForegroundRun || params.alreadyCheckpointedThisRun) {
    return NO_CHECKPOINT;
  }

  if (Number.isFinite(params.iteration) && params.iteration >= FOREGROUND_MAX_TOOL_ITERATIONS) {
    return { shouldCheckpoint: true, reason: 'foreground_iteration_limit' };
  }

  if (Number.isFinite(params.elapsedMs) && params.elapsedMs >= FOREGROUND_MAX_WALL_CLOCK_MS) {
    return { shouldCheckpoint: true, reason: 'foreground_wall_clock_limit' };
  }

  return NO_CHECKPOINT;
}
