// ---------------------------------------------------------------------------
// Kavi — Stagnant-progress loop recovery contract
// ---------------------------------------------------------------------------
// A loop-recovery hint is a prompt for the model. It must never recommend the tool
// the model is already looping on: the stagnant-progress hint previously advised
// "complete or update goals" while the model repeated update_goals, which
// reinforced the loop until the detector terminated the run.
// ---------------------------------------------------------------------------

import { buildAgentControlGraphLoopRecoveryDecision } from '../../src/engine/graph/loopRecovery';
import type { AgentGoal } from '../../src/types/agentRun';
import type { LoopDetectionResult, ToolCallRecord } from '../../src/engine/loopDetection';

function goal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'goal-1',
    name: 'Produce the brief',
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: ['evidence.artifact:europe-transport-brief.md'],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as AgentGoal;
}

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
  details: 'Goal state did not advance.',
} as LoopDetectionResult;

function warningFor(params: {
  goals?: AgentGoal[];
  toolCallHistory?: ToolCallRecord[];
}): string {
  const decision = buildAgentControlGraphLoopRecoveryDecision({
    loopCheck: stagnant,
    warningAlreadyInjected: false,
    iteration: 22,
    maxIterations: 40,
    goals: params.goals ?? [goal()],
    toolCallHistory: params.toolCallHistory ?? history('update_goals', 13),
  });
  if (decision.type !== 'warning') throw new Error(`expected warning, got ${decision.type}`);
  return decision.warningMessage;
}

describe('stagnant progress loop recovery', () => {
  it('does not advise updating goals while the model loops on update_goals', () => {
    const message = warningFor({});

    expect(message).not.toMatch(/complete or update goals/i);
  });

  it('prohibits the repeated tool by name', () => {
    const message = warningFor({});

    expect(message).toContain('Do not call update_goals again this turn');
  });

  it('names the concrete action that records the missing evidence', () => {
    const message = warningFor({});

    expect(message).toContain('write europe-transport-brief.md with write_file');
  });

  it('states that goal bookkeeping is not evidence', () => {
    const message = warningFor({});

    expect(message).toContain('Goal bookkeeping does not record evidence');
  });

  it('names the tool-evidence action when the criterion names a tool', () => {
    const message = warningFor({
      goals: [goal({ successCriteria: ['evidence.tool:web_search'] })],
      toolCallHistory: history('update_goals', 4),
    });

    expect(message).toContain('call web_search');
  });

  it('omits an action for count-only criteria rather than inventing one', () => {
    const message = warningFor({
      goals: [goal({ successCriteria: ['evidence.min:2'] })],
    });

    expect(message).toContain('Take a concrete step toward the deliverable');
    expect(message).not.toMatch(/write_file/);
  });

  it('does not prohibit a tool that was only called once', () => {
    const message = warningFor({ toolCallHistory: history('write_file', 1) });

    expect(message).not.toMatch(/Do not call write_file again/);
  });

  it('skips criteria already satisfied by recorded evidence', () => {
    const message = warningFor({
      goals: [
        goal({
          successCriteria: ['evidence.tool:web_search'],
          evidence: ['web_search:{"results":[]}'],
        }),
      ],
    });

    expect(message).not.toContain('call web_search');
  });

  it('still blocks outright on a critical loop', () => {
    const decision = buildAgentControlGraphLoopRecoveryDecision({
      loopCheck: { ...stagnant, level: 'critical' } as LoopDetectionResult,
      warningAlreadyInjected: true,
      iteration: 30,
      maxIterations: 40,
      goals: [goal()],
      toolCallHistory: history('update_goals', 13),
    });

    expect(decision.type).toBe('block');
  });
});
