import { resolveNextLongHorizonIterationLimit } from '../../src/engine/graph/longHorizonIterationBudget';
import type { ToolCallRecord } from '../../src/engine/loopDetection';
import {
  FOREGROUND_MAX_TOOL_ITERATIONS,
  MAX_TOOL_ITERATIONS_OVERRIDE,
} from '../../src/engine/orchestrator/constants';

function toolOutcome(status: ToolCallRecord['status'], timestamp: number): ToolCallRecord {
  return {
    name: status === 'completed' ? 'read_file' : 'sessions_spawn',
    arguments: '{}',
    timestamp,
    status,
  };
}

describe('long-horizon iteration budget', () => {
  it('extends a default run with recent completed progress', () => {
    expect(
      resolveNextLongHorizonIterationLimit({
        enabled: true,
        currentLimit: 40,
        extensionSize: 40,
        toolCallHistory: [toolOutcome('completed', 1), toolOutcome('completed', 2)],
      }),
    ).toBe(80);
  });

  it('does not override an explicit caller budget', () => {
    expect(
      resolveNextLongHorizonIterationLimit({
        enabled: false,
        currentLimit: 40,
        extensionSize: 40,
        toolCallHistory: [toolOutcome('completed', 1), toolOutcome('completed', 2)],
      }),
    ).toBeNull();
  });

  it('requires a healthy recent outcome window', () => {
    expect(
      resolveNextLongHorizonIterationLimit({
        enabled: true,
        currentLimit: 40,
        extensionSize: 40,
        toolCallHistory: [
          toolOutcome('completed', 1),
          toolOutcome('failed', 2),
          toolOutcome('failed', 3),
        ],
      }),
    ).toBeNull();
  });

  it('clamps extensions to the global hard ceiling', () => {
    expect(
      resolveNextLongHorizonIterationLimit({
        enabled: true,
        currentLimit: MAX_TOOL_ITERATIONS_OVERRIDE - 16,
        extensionSize: 40,
        toolCallHistory: [toolOutcome('completed', 1), toolOutcome('completed', 2)],
      }),
    ).toBe(MAX_TOOL_ITERATIONS_OVERRIDE);
    expect(
      resolveNextLongHorizonIterationLimit({
        enabled: true,
        currentLimit: MAX_TOOL_ITERATIONS_OVERRIDE,
        extensionSize: 40,
        toolCallHistory: [toolOutcome('completed', 1), toolOutcome('completed', 2)],
      }),
    ).toBeNull();
  });

  describe('foreground interaction budget', () => {
    it('never extends a foreground run past FOREGROUND_MAX_TOOL_ITERATIONS', () => {
      expect(
        resolveNextLongHorizonIterationLimit({
          enabled: true,
          currentLimit: FOREGROUND_MAX_TOOL_ITERATIONS - 4,
          extensionSize: 40,
          toolCallHistory: [toolOutcome('completed', 1), toolOutcome('completed', 2)],
          isForegroundRun: true,
        }),
      ).toBe(FOREGROUND_MAX_TOOL_ITERATIONS);
    });

    it('refuses to extend a foreground run already at the foreground ceiling', () => {
      expect(
        resolveNextLongHorizonIterationLimit({
          enabled: true,
          currentLimit: FOREGROUND_MAX_TOOL_ITERATIONS,
          extensionSize: 40,
          toolCallHistory: [toolOutcome('completed', 1), toolOutcome('completed', 2)],
          isForegroundRun: true,
        }),
      ).toBeNull();
    });

    it('clamps to the foreground ceiling even if a caller passes a higher explicit hardLimit', () => {
      expect(
        resolveNextLongHorizonIterationLimit({
          enabled: true,
          currentLimit: FOREGROUND_MAX_TOOL_ITERATIONS - 1,
          extensionSize: 40,
          toolCallHistory: [toolOutcome('completed', 1), toolOutcome('completed', 2)],
          hardLimit: MAX_TOOL_ITERATIONS_OVERRIDE,
          isForegroundRun: true,
        }),
      ).toBe(FOREGROUND_MAX_TOOL_ITERATIONS);
    });

    it('does not clamp a delegated worker or background run to the foreground ceiling', () => {
      expect(
        resolveNextLongHorizonIterationLimit({
          enabled: true,
          currentLimit: 30,
          extensionSize: 40,
          toolCallHistory: [toolOutcome('completed', 1), toolOutcome('completed', 2)],
          isForegroundRun: false,
        }),
      ).toBe(70);
    });
  });
});
