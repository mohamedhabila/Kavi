// ---------------------------------------------------------------------------
// Kavi — Blocking-goal abandonment transition
// ---------------------------------------------------------------------------
// Blocking a blocking goal used to be refused unconditionally, leaving an agent
// that had exhausted its options with no sanctioned move. It now succeeds only
// when every available path was genuinely tried, and otherwise reports the
// concrete step that remains.
// ---------------------------------------------------------------------------

import { validateGoalMutation } from '../../src/engine/goals/validation';
import { createGoal } from '../../src/engine/goals/types';
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
  goals: [{ id: 'goal-1' }],
} as AgentGoalMutation;

function call(name: string, args: string): ToolCallRecord {
  return { name, arguments: args, status: 'failed', timestamp: 1 };
}

describe('blocking goal abandonment', () => {
  it('refuses an unearned claim after repeating one call', () => {
    const result = validateGoalMutation(blockMutation, [blockingGoal()], {
      toolCallHistory: Array.from({ length: 13 }, () => call('update_goals', '{"a":1}')),
      capabilityToolNames: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'evidence_required')).toBe(true);
  });

  it('names the untried path instead of refusing without direction', () => {
    const result = validateGoalMutation(blockMutation, [blockingGoal()], {
      toolCallHistory: [call('web_search', '{"q":"a"}')],
      capabilityToolNames: ['web_search', 'write_file'],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.message).join(' ')).toContain('write_file');
  });

  it('accepts the claim once every available path has failed', () => {
    const result = validateGoalMutation(blockMutation, [blockingGoal()], {
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('write_file', '{"path":"brief.md"}')],
      capabilityToolNames: ['web_search', 'write_file'],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('still refuses to abandon a goal whose evidence is already satisfied', () => {
    const satisfied = blockingGoal({
      successCriteria: ['evidence.tool:web_search'],
      evidence: ['web_search:{"results":[1]}'],
    });

    const result = validateGoalMutation(blockMutation, [satisfied], {
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('write_file', '{"path":"b"}')],
      capabilityToolNames: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'evidence_satisfied')).toBe(true);
  });

  it('requires asking the user before abandoning when clarification is available', () => {
    const result = validateGoalMutation(blockMutation, [blockingGoal()], {
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('write_file', '{"path":"b"}')],
      capabilityToolNames: ['web_search', 'write_file'],
      clarificationToolName: 'request_clarification',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.message).join(' ')).toContain(
      'request_clarification',
    );
  });

  it('keeps refusing to block a pending goal', () => {
    const result = validateGoalMutation(blockMutation, [blockingGoal({ status: 'pending' })], {
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('write_file', '{"path":"b"}')],
      capabilityToolNames: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'invalid_block')).toBe(true);
  });

  it('does not depend on validation context being supplied', () => {
    const result = validateGoalMutation(blockMutation, [blockingGoal()]);

    expect(result.valid).toBe(false);
  });
});
