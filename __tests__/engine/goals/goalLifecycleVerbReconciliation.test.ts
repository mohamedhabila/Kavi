import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import { parseUpdateGoalsArgs } from '../../../src/engine/tools/toolGoalExecution';
import { createGoal } from '../../../src/engine/goals/types';
import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';

// Traced live on an Android emulator. `add` and `update` carrying status "completed" were
// refused with "Use action \"complete\" for the canonical goal completion transition." — a
// rejection that names the exact transition it declines to perform. The model restated the
// same intent as a second call, which is the duplicated update_goals pattern seen across
// runs, with the first of each pair failing.

const BRIEF = 'artifacts/brief.md';

function parse(args: Record<string, unknown>) {
  return parseUpdateGoalsArgs(args);
}

describe('asking to complete a goal is not rejected for the verb used', () => {
  it('accepts add with a completed status instead of refusing it', () => {
    const parsed = parse({
      action: 'add',
      id: 'desal-study',
      name: 'desal-study',
      completionPolicy: 'blocking',
      successCriteria: [`evidence.artifact:${BRIEF}`],
      status: 'completed',
    });

    expect(parsed.errors).toEqual([]);
  });

  it('accepts update with a completed status instead of refusing it', () => {
    const parsed = parse({ action: 'update', id: 'desal-study', status: 'completed' });

    expect(parsed.errors).toEqual([]);
  });
});

describe('a goal is still never born already closed', () => {
  it('creates it open, so the evidence gate keeps its meaning', () => {
    const result = applyGoalMutation([], {
      action: 'add',
      goals: [
        {
          id: 'desal-study',
          title: 'desal-study',
          completionPolicy: 'blocking',
          successCriteria: [`evidence.artifact:${BRIEF}`],
          status: 'completed',
        },
      ],
    } as never);

    expect(result.errors).toEqual([]);
    // Accepting the status verbatim would mint a closed blocking goal with no evidence.
    expect(result.goals[0]?.status).not.toBe('completed');
  });

  it('still honours an active status on add, so no separate activate is needed', () => {
    const result = applyGoalMutation([], {
      action: 'add',
      goals: [
        {
          id: 'desal-study',
          title: 'desal-study',
          completionPolicy: 'blocking',
          successCriteria: [`evidence.artifact:${BRIEF}`],
          status: 'active',
        },
      ],
    } as never);

    expect(result.errors).toEqual([]);
    expect(result.goals[0]?.status).toBe('active');
  });
});

describe('update with a completed status routes to the canonical transition', () => {
  const open = () =>
    createGoal({
      id: 'desal-study',
      title: 'desal-study',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: [`evidence.artifact:${BRIEF}`],
    });

  // The invariant is that the update verb is rewritten to the complete transition rather
  // than taking a path of its own, so the two are compared directly instead of through a
  // refusal they happened to share. Stated this way it holds whatever `complete` does:
  // it used to refuse an unmet goal and now closes it, and the equivalence is unchanged.
  it('is a rewrite, not a bypass: it lands exactly where complete lands', () => {
    const viaUpdate = applyGoalMutation([open()], {
      action: 'update',
      goals: [{ id: 'desal-study', status: 'completed' }],
    } as never);
    const viaComplete = applyGoalMutation([open()], {
      action: 'complete',
      goals: [{ id: 'desal-study' }],
    } as never);

    expect(viaUpdate.errors).toEqual(viaComplete.errors);
    expect(viaUpdate.goals[0]?.status).toBe(viaComplete.goals[0]?.status);
    // Never refused for the verb itself.
    expect(viaUpdate.errors.join(' ')).not.toContain('canonical goal completion transition');
  });

  it('leaves an ordinary update alone', () => {
    const result = applyGoalMutation([open()], {
      action: 'update',
      goals: [{ id: 'desal-study', description: 'Refined scope' }],
    } as never);

    expect(result.errors).toEqual([]);
    expect(result.goals[0]?.status).toBe('active');
  });
});

describe('the schema tells the model one call is enough', () => {
  it('documents setting active on the add itself', () => {
    const status = (
      UPDATE_GOALS_TOOL.input_schema as { properties?: Record<string, { description?: string }> }
    ).properties?.status?.description;

    expect(status).toContain('a separate activate call is not needed');
  });
});
