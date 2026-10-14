import { resolveNextLongHorizonIterationLimit } from '../../src/engine/graph/longHorizonIterationBudget';
import type { ToolCallRecord } from '../../src/engine/loopDetection';
import { MAX_TOOL_ITERATIONS_OVERRIDE } from '../../src/engine/orchestrator/constants';

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
});
