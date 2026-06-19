import { applyGoalMutation } from '../../src/engine/goals/graphState';
import type { AgentGoal, AgentGoalMutation } from '../../src/engine/goals/types';

function applyRecoverableMutation(
  goals: ReadonlyArray<AgentGoal>,
  mutation: AgentGoalMutation,
): AgentGoal[] {
  const result = applyGoalMutation(goals, mutation, 1_000);
  expect(result.errors).toEqual([]);
  return result.goals;
}

describe('error recovery benchmark', () => {
  it('recovers from malformed focus-goal mutations and reaches the target graph state', () => {
    let goals: AgentGoal[] = [];

    goals = applyRecoverableMutation(goals, {
      action: 'add',
      goals: [
        {
          id: 'scope-a',
          title: 'scope-a-planning',
          status: 'active',
          completionPolicy: 'persistent',
        },
      ],
    });

    goals = applyRecoverableMutation(goals, {
      action: 'complete',
      goals: [{ id: 'scope-a', evidence: ['turn:scope-a-token'] }],
    });

    goals = applyRecoverableMutation(goals, {
      action: 'add',
      goals: [
        {
          id: 'scope-b',
          title: 'scope-b-planning',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['scope-b-planning'],
        },
      ],
    });

    expect(goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'scope-a',
          status: 'pending',
          completionPolicy: 'persistent',
          evidence: ['turn:scope-a-token'],
        }),
        expect.objectContaining({
          id: 'scope-b',
          status: 'active',
          completionPolicy: 'persistent',
        }),
      ]),
    );
    expect(goals.find((goal) => goal.id === 'scope-b')?.successCriteria).toBeUndefined();
  });

  it('keeps unsafe deliverable evidence failures hard', () => {
    const result = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          {
            id: 'unsafe-deliverable',
            title: 'unsafe-deliverable',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.tool:update_goals'],
          },
        ],
      },
      1_000,
    );

    expect(result.goals).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Graph-control and discovery tools cannot be used'),
      ]),
    );
  });
});
