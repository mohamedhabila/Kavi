import { validateGoalMutation } from '../../../src/engine/goals/validation';
import { areBlockingGoalsStructurallyComplete } from '../../../src/engine/goals/completionEvidence';
import { validateToolArgumentsAgainstSchema } from '../../../src/engine/toolExecution/toolArgumentSchemaValidation';
import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';
import type { AgentGoal } from '../../../src/engine/goals/types';

// Traced live on an Android emulator across a 24-call run that ended in loop_detected:
//
//   complete mc-npv                     x4 consecutively
//   complete [report, sensitivity, ...] x4
//   activate mc-npv -> complete mc-npv
//
// The completes were refused for want of evidence, and a pending goal was refused with
// "Use activate first", so the model reactivated goals, re-ran python and rewrote files
// trying to manufacture evidence the gate would accept. Closing a goal is the model's own
// bookkeeping; refusing it never protected anything, because finalization evaluates the
// criteria itself.

function goal(id: string, overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id,
    title: id,
    status: 'active',
    dependencies: [],
    evidence: [],
    completionPolicy: 'blocking',
    successCriteria: ['evidence.artifact:artifacts/out.md'],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AgentGoal;
}

function completeErrors(goals: ReadonlyArray<AgentGoal>, id: string) {
  const result = validateGoalMutation({ action: 'complete', goals: [{ id }] } as never, goals);
  return (result.errors ?? []).map((error) => error.message);
}

describe('closing a goal is the model deciding, not a claim of proof', () => {
  it('completes an active goal whose criteria are unmet', () => {
    expect(completeErrors([goal('g1')], 'g1')).toEqual([]);
  });

  it('completes a pending goal without demanding activation first', () => {
    expect(completeErrors([goal('g1', { status: 'pending' })], 'g1')).toEqual([]);
  });

  it('completes a goal carrying no criteria and no evidence', () => {
    const bare = goal('g1', { successCriteria: undefined, completionPolicy: 'persistent' });
    expect(completeErrors([bare], 'g1')).toEqual([]);
  });

  it('completes several goals in one call', () => {
    const goals = [goal('a'), goal('b', { status: 'pending' }), goal('c')];
    const result = validateGoalMutation(
      { action: 'complete', goals: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } as never,
      goals,
    );
    expect(result.errors ?? []).toEqual([]);
  });
});

describe('finalization still requires the evidence', () => {
  // The relaxation is safe precisely because this gate reads the criteria, not the status.
  it('refuses to call a run complete when a closed goal proved nothing', () => {
    const closed = goal('g1', { status: 'completed' });
    expect(areBlockingGoalsStructurallyComplete([closed])).toBe(false);
  });

  it('accepts a run whose closed goal actually proved its criterion', () => {
    const proven = goal('g1', {
      status: 'completed',
      successCriteria: ['evidence.min:1'],
      evidence: ['python: computed the percentiles'],
    });
    expect(areBlockingGoalsStructurallyComplete([proven])).toBe(true);
  });
});

describe('a batch that states its action per entry', () => {
  it('is accepted without repeating the action at the root', () => {
    // The executor already derives the action from the entries; only the preflight
    // disagreed, answering missing_required_argument for a complete, unambiguous payload.
    const refusal = validateToolArgumentsAgainstSchema({
      toolName: 'update_goals',
      argumentsText: JSON.stringify({
        goals: [
          { action: 'complete', id: 'report' },
          { action: 'complete', id: 'sensitivity' },
        ],
      }),
      tools: [UPDATE_GOALS_TOOL],
    });

    expect(refusal).toBeUndefined();
  });

  it('still refuses when an entry omits the field and the root does too', () => {
    const refusal = validateToolArgumentsAgainstSchema({
      toolName: 'update_goals',
      argumentsText: JSON.stringify({
        goals: [{ action: 'complete', id: 'report' }, { id: 'sensitivity' }],
      }),
      tools: [UPDATE_GOALS_TOOL],
    });

    expect(refusal).toContain('missing_required_argument');
  });

  it('still refuses a call that supplies the field nowhere', () => {
    const refusal = validateToolArgumentsAgainstSchema({
      toolName: 'update_goals',
      argumentsText: JSON.stringify({ id: 'report' }),
      tools: [UPDATE_GOALS_TOOL],
    });

    expect(refusal).toContain('missing_required_argument');
  });
});
