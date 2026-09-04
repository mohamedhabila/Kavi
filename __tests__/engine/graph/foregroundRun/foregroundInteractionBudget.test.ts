import { evaluateForegroundInteractionBudgetCheckpoint } from '../../../../src/engine/graph/foregroundRun/foregroundInteractionBudget';
import {
  FOREGROUND_MAX_TOOL_ITERATIONS,
  FOREGROUND_MAX_WALL_CLOCK_MS,
} from '../../../../src/engine/orchestrator/constants';

describe('foreground interaction budget checkpoint', () => {
  it('forces a checkpoint once a foreground run reaches the iteration ceiling', () => {
    expect(
      evaluateForegroundInteractionBudgetCheckpoint({
        isForegroundRun: true,
        iteration: FOREGROUND_MAX_TOOL_ITERATIONS,
        elapsedMs: 0,
      }),
    ).toEqual({ shouldCheckpoint: true, reason: 'foreground_iteration_limit' });
  });

  it('does not checkpoint below the iteration ceiling', () => {
    expect(
      evaluateForegroundInteractionBudgetCheckpoint({
        isForegroundRun: true,
        iteration: FOREGROUND_MAX_TOOL_ITERATIONS - 1,
        elapsedMs: 0,
      }),
    ).toEqual({ shouldCheckpoint: false });
  });

  it('forces a checkpoint once a foreground run reaches the wall-clock ceiling', () => {
    expect(
      evaluateForegroundInteractionBudgetCheckpoint({
        isForegroundRun: true,
        iteration: 1,
        elapsedMs: FOREGROUND_MAX_WALL_CLOCK_MS,
      }),
    ).toEqual({ shouldCheckpoint: true, reason: 'foreground_wall_clock_limit' });
  });

  it('does not checkpoint below the wall-clock ceiling', () => {
    expect(
      evaluateForegroundInteractionBudgetCheckpoint({
        isForegroundRun: true,
        iteration: 1,
        elapsedMs: FOREGROUND_MAX_WALL_CLOCK_MS - 1,
      }),
    ).toEqual({ shouldCheckpoint: false });
  });

  it('prefers the iteration reason when both ceilings are reached simultaneously', () => {
    expect(
      evaluateForegroundInteractionBudgetCheckpoint({
        isForegroundRun: true,
        iteration: FOREGROUND_MAX_TOOL_ITERATIONS,
        elapsedMs: FOREGROUND_MAX_WALL_CLOCK_MS,
      }),
    ).toEqual({ shouldCheckpoint: true, reason: 'foreground_iteration_limit' });
  });

  it('checkpoints once real elapsed wall-clock time crosses the ceiling (fake timers)', () => {
    jest.useFakeTimers();
    try {
      const runStartedAt = Date.now();
      jest.advanceTimersByTime(FOREGROUND_MAX_WALL_CLOCK_MS - 1);
      expect(
        evaluateForegroundInteractionBudgetCheckpoint({
          isForegroundRun: true,
          iteration: 1,
          elapsedMs: Date.now() - runStartedAt,
        }),
      ).toEqual({ shouldCheckpoint: false });

      jest.advanceTimersByTime(1);
      expect(
        evaluateForegroundInteractionBudgetCheckpoint({
          isForegroundRun: true,
          iteration: 1,
          elapsedMs: Date.now() - runStartedAt,
        }),
      ).toEqual({ shouldCheckpoint: true, reason: 'foreground_wall_clock_limit' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('never checkpoints a delegated worker or background run, no matter the iteration count', () => {
    expect(
      evaluateForegroundInteractionBudgetCheckpoint({
        isForegroundRun: false,
        iteration: 30,
        elapsedMs: FOREGROUND_MAX_WALL_CLOCK_MS * 10,
      }),
    ).toEqual({ shouldCheckpoint: false });
  });

  it('does not re-fire once the run has already been checkpointed', () => {
    expect(
      evaluateForegroundInteractionBudgetCheckpoint({
        isForegroundRun: true,
        iteration: FOREGROUND_MAX_TOOL_ITERATIONS + 5,
        elapsedMs: FOREGROUND_MAX_WALL_CLOCK_MS + 5_000,
        alreadyCheckpointedThisRun: true,
      }),
    ).toEqual({ shouldCheckpoint: false });
  });
});
