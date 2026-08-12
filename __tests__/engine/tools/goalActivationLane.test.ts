import { executeUpdateGoals } from '../../../src/engine/tools/toolGoalExecution';
import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';
import type { AgentGoal } from '../../../src/engine/goals/types';

// Exactly one goal is active per owner lane, so activating a goal demotes whichever goal
// was active there. Nothing reported that, and the tool guidance actively worked against
// it by telling the model to mark every step of a plan "active".
//
// Measured against the real mutation code:
//   add [g1, g2, g3] all active  ->  g1=pending g2=pending g3=active
//   activate g1                  ->  g1=active  g2=pending g3=pending
//
// Traced live, that cost twelve update_goals calls on four goals: the model re-activated
// each step as it reached it, demoting another every time.

function goal(id: string, overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id,
    title: id,
    status: 'pending',
    dependencies: [],
    evidence: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AgentGoal;
}

function resultOf(args: Record<string, unknown>, goals: ReadonlyArray<AgentGoal>) {
  return JSON.parse(executeUpdateGoals(args, goals).content ?? '{}');
}

describe('the lane rule the model was never told about', () => {
  it('keeps only the last goal active when a plan marks several active', () => {
    const applied = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          { id: 'g1', title: 'One', status: 'active', completionPolicy: 'blocking', successCriteria: ['evidence.artifact:a.md'] },
          { id: 'g2', title: 'Two', status: 'active', completionPolicy: 'blocking', successCriteria: ['evidence.artifact:b.md'] },
          { id: 'g3', title: 'Three', status: 'active', completionPolicy: 'blocking', successCriteria: ['evidence.artifact:c.md'] },
        ],
      } as never,
      1000,
    );

    expect(applied.goals.map((entry) => `${entry.id}=${entry.status}`)).toEqual([
      'g1=pending',
      'g2=pending',
      'g3=active',
    ]);
  });

  it('demotes the previously active goal when another is activated', () => {
    const goals = [goal('g1'), goal('g2', { status: 'active' })];
    const applied = applyGoalMutation(goals, { action: 'activate', goals: [{ id: 'g1' }] } as never, 2000);

    expect(applied.goals.find((entry) => entry.id === 'g2')?.status).toBe('pending');
  });
});

describe('reporting what an activation moved', () => {
  it('names the goal moved back to pending', () => {
    const goals = [goal('g1'), goal('g2', { status: 'active' })];
    const result = resultOf({ action: 'activate', id: 'g1' }, goals);

    expect(result.activationSideEffect.movedToPending).toEqual(['g2']);
    expect(result.activationSideEffect.reason).toContain('One goal is active at a time');
  });

  it('says which of several requested activations will not stick', () => {
    const goals = [goal('g1'), goal('g2'), goal('g3')];
    const result = resultOf(
      {
        action: 'add',
        goals: [
          { id: 'g1', name: 'One', status: 'active', completionPolicy: 'blocking' },
          { id: 'g2', name: 'Two', status: 'active', completionPolicy: 'blocking' },
        ],
      },
      goals,
    );

    expect(result.activationSideEffect.notActivated).toEqual(['g1']);
  });

  it('stays quiet when an activation displaces nothing', () => {
    const goals = [goal('g1'), goal('g2')];
    expect(resultOf({ action: 'activate', id: 'g1' }, goals).activationSideEffect).toBeUndefined();
  });

  it('stays quiet for actions that activate nothing', () => {
    const goals = [goal('g1'), goal('g2', { status: 'active' })];
    expect(resultOf({ action: 'complete', id: 'g1' }, goals).activationSideEffect).toBeUndefined();
  });

  it('does not report across owner lanes, which are independent', () => {
    const goals = [goal('w1', { status: 'active', owner: 'delegated-worker' }), goal('s1')];
    expect(resultOf({ action: 'activate', id: 's1' }, goals).activationSideEffect).toBeUndefined();
  });

  it('behaves as before when no graph is supplied', () => {
    expect(
      JSON.parse(executeUpdateGoals({ action: 'activate', id: 'g1' }).content ?? '{}')
        .activationSideEffect,
    ).toBeUndefined();
  });
});

describe('the guidance matches the rule', () => {
  it('tells the model to keep later steps pending', () => {
    expect(UPDATE_GOALS_TOOL.description).toContain('Only one goal is active at a time');
    expect(UPDATE_GOALS_TOOL.description).toContain('"status":"pending"');
  });

  it('no longer claims every entry can be marked active', () => {
    expect(UPDATE_GOALS_TOOL.description).not.toContain(
      'Set `status` on each entry so a separate activate is never needed',
    );
  });
});

describe('steps that have no deliverable', () => {
  // Traced live: the model authored a `verify` goal as blocking with only
  // evidence.min/evidence.count, which is refused — and the refusal discarded the four
  // valid goals declared alongside it, forcing a full re-send. A verification step has
  // nothing specific to assert, so the contract now says to make it persistent.
  it('tells the model to make a review or verification persistent', () => {
    const criteria = (UPDATE_GOALS_TOOL.input_schema as { properties: Record<string, { description: string }> })
      .properties.successCriteria.description;

    expect(criteria).toContain('no concrete deliverable');
    expect(criteria).toContain('persistent');
  });

  it('tells the model a delegated write satisfies the same criterion', () => {
    const criteria = (UPDATE_GOALS_TOOL.input_schema as { properties: Record<string, { description: string }> })
      .properties.successCriteria.description;

    expect(criteria).toContain('delegated worker satisfies the same evidence.artifact');
    expect(criteria).toContain('do not rewrite it yourself');
  });
});
