// ---------------------------------------------------------------------------
// Kavi — Earned abandonment is a distinct outcome
// ---------------------------------------------------------------------------
// A goal abandoned through the exhaustion gate ended the turn honestly. A goal
// blocked by a code-owned failure did not. Conflating them either reports real
// malfunctions as success or reports honest conclusions as crashes, so the stamp
// that separates them must be code-owned and unreachable from a model patch.
// ---------------------------------------------------------------------------

import { applyGoalMutation } from '../../src/engine/goals/graphState';
import {
  createGoal,
  hasUnearnedBlockedBlockingGoals,
  isAbandonedAfterExhaustionGoal,
} from '../../src/engine/goals/types';
import type { AgentGoal, AgentGoalMutation } from '../../src/engine/goals/types';
import type { ToolCallRecord } from '../../src/engine/loopDetection';

function blockingGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return createGoal({
    id: 'goal-1',
    title: 'Produce the brief',
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: ['evidence.artifact:brief.md'],
    evidence: [],
    ...overrides,
  });
}

const blockMutation: AgentGoalMutation = {
  action: 'block',
  goals: [{ id: 'goal-1', blockedReason: 'every source rejected the request' }],
} as AgentGoalMutation;

function exhaustedHistory(): ToolCallRecord[] {
  return [
    { name: 'web_search', arguments: '{"q":"a"}', status: 'failed', timestamp: 1 },
    { name: 'write_file', arguments: '{"path":"brief.md"}', status: 'failed', timestamp: 2 },
  ];
}

describe('earned abandonment', () => {
  it('stamps a goal abandoned through the exhaustion gate', () => {
    const { goals, errors } = applyGoalMutation([blockingGoal()], blockMutation, 1234, {
      toolCallHistory: exhaustedHistory(),
      capabilityToolNames: ['web_search', 'write_file'],
    });

    expect(errors).toEqual([]);
    expect(goals[0].status).toBe('blocked');
    expect(goals[0].abandonedAfterExhaustionAt).toBe(1234);
    expect(isAbandonedAfterExhaustionGoal(goals[0])).toBe(true);
  });

  it('does not treat an earned abandonment as an unearned block', () => {
    const { goals } = applyGoalMutation([blockingGoal()], blockMutation, 1234, {
      toolCallHistory: exhaustedHistory(),
      capabilityToolNames: ['web_search', 'write_file'],
    });

    expect(hasUnearnedBlockedBlockingGoals(goals)).toBe(false);
  });

  it('treats a code-driven block as unearned', () => {
    // Code-owned paths set blocked status directly rather than through a validated
    // mutation, so they never carry the stamp.
    const codeBlocked = blockingGoal({ status: 'blocked', blockedReason: 'effect unverified' });

    expect(isAbandonedAfterExhaustionGoal(codeBlocked)).toBe(false);
    expect(hasUnearnedBlockedBlockingGoals([codeBlocked])).toBe(true);
  });

  it('does not stamp a goal when the abandonment claim is refused', () => {
    const { goals, errors } = applyGoalMutation([blockingGoal()], blockMutation, 1234, {
      toolCallHistory: [],
      capabilityToolNames: ['web_search'],
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(goals[0].status).toBe('active');
    expect(goals[0].abandonedAfterExhaustionAt).toBeUndefined();
  });

  it('ignores a model-supplied stamp on the mutation patch', () => {
    const forged = {
      action: 'block',
      goals: [{ id: 'goal-1', abandonedAfterExhaustionAt: 999 }],
    } as unknown as AgentGoalMutation;

    const { goals, errors } = applyGoalMutation([blockingGoal()], forged, 1234, {
      toolCallHistory: [],
      capabilityToolNames: ['web_search'],
    });

    // The claim is refused, so no stamp is applied regardless of what was supplied.
    expect(errors.length).toBeGreaterThan(0);
    expect(goals[0].abandonedAfterExhaustionAt).toBeUndefined();
  });
});
