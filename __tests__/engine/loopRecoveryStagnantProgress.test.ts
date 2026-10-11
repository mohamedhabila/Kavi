// ---------------------------------------------------------------------------
// Kavi — Stagnant-progress loop recovery contract
// ---------------------------------------------------------------------------
// A loop-recovery hint is a prompt for the model. It must never recommend the tool
// the model is already looping on: the stagnant-progress hint once advised "complete
// or update goals" while the model repeated its goal tool, which reinforced the loop
// until the detector terminated the run.
// ---------------------------------------------------------------------------

import { buildAgentControlGraphLoopRecoveryDecision } from '../../src/engine/graph/loopRecovery';
import type { LoopDetectionResult, ToolCallRecord } from '../../src/engine/loopDetection';

function history(name: string, count: number): ToolCallRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    name,
    arguments: '{}',
    timestamp: index,
    status: 'completed' as const,
  }));
}

const stagnant: LoopDetectionResult = {
  loopDetected: true,
  level: 'warning',
  type: 'stagnant_progress',
  details: 'Tool multiset update_plan repeated 3 iterations without semantic progress.',
} as LoopDetectionResult;

function warningFor(toolCallHistory: ToolCallRecord[]): string {
  const decision = buildAgentControlGraphLoopRecoveryDecision({
    loopCheck: stagnant,
    warningAlreadyInjected: false,
    iteration: 22,
    maxIterations: 40,
    toolCallHistory,
  });
  if (decision.type !== 'warning') throw new Error(`expected warning, got ${decision.type}`);
  return decision.warningMessage;
}

describe('stagnant progress loop recovery', () => {
  it('prohibits the repeated tool by name instead of recommending it', () => {
    const message = warningFor(history('update_plan', 4));

    expect(message).toContain('Do not call update_plan again this turn');
    expect(message).not.toMatch(/update the plan|update_plan with/i);
  });

  it('points at a different concrete step, or an answer with what is known', () => {
    const message = warningFor(history('web_search', 3));

    expect(message).toContain('Take a different concrete step toward the deliverable');
    expect(message).toContain('answer with what you have');
  });

  it('does not prohibit a tool that was only called once', () => {
    const message = warningFor(history('write_file', 1));

    expect(message).not.toMatch(/Do not call write_file again/);
  });

  it('still blocks outright on a critical loop', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: { ...stagnant, level: 'critical' } as LoopDetectionResult,
      warningAlreadyInjected: true,
      iteration: 30,
      maxIterations: 40,
      toolCallHistory: history('update_plan', 13),
    });

    expect(decision.type).toBe('block');
  });
});
