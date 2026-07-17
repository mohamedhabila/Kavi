import {
  resolveGraphTaskId,
  resolveGraphWorkingBlockScope,
} from '../../src/engine/goals/graphTaskScope';
import {
  CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
  type AgentGoal,
} from '../../src/engine/goals/types';

describe('graphTaskScope', () => {
  const goals: AgentGoal[] = [
    {
      id: 'meal-plan',
      title: 'meal-planning-scope',
      status: 'active',
      dependencies: [],
      evidence: [],
      createdAt: 1,
      updatedAt: 1,
      successCriteria: [],
    },
  ];

  it('uses activeTaskId when it points at a live graph goal', () => {
    expect(
      resolveGraphTaskId({
        goals: [
          ...goals,
          {
            id: 'pinned-task',
            title: 'Pinned task',
            status: 'pending',
            dependencies: [],
            evidence: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeTaskId: 'pinned-task',
      }),
    ).toBe('pinned-task');
  });

  it('ignores stale activeTaskId when graph goals no longer contain it', () => {
    expect(
      resolveGraphTaskId({
        goals: [],
        activeTaskId: 'stale-task',
      }),
    ).toBeUndefined();
    expect(
      resolveGraphWorkingBlockScope({
        conversationId: 'conv-scope',
        graphState: { goals: [], activeTaskId: 'stale-task' },
      }),
    ).toEqual({
      conversationId: 'conv-scope',
      threadId: 'conv-scope',
    });
  });

  it('falls back to active goal id when activeTaskId is absent', () => {
    expect(resolveGraphTaskId({ goals })).toBe('meal-plan');
  });

  it('never turns internal effect-completion bookkeeping into memory task scope', () => {
    const internalGoal: AgentGoal = {
      id: 'effect-memory-remember-request',
      title: 'Verify memory_remember effect',
      status: 'active',
      dependencies: [],
      evidence: [],
      createdAt: 1,
      updatedAt: 1,
      owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
      completionPolicy: 'blocking',
    };

    expect(
      resolveGraphTaskId({
        goals: [internalGoal],
        activeTaskId: internalGoal.id,
      }),
    ).toBeUndefined();
    expect(
      resolveGraphWorkingBlockScope({
        conversationId: 'conv-internal-effect',
        graphState: { goals: [internalGoal], activeTaskId: internalGoal.id },
      }),
    ).toEqual({
      conversationId: 'conv-internal-effect',
      threadId: 'conv-internal-effect',
    });
  });

  it('falls through an internal effect goal to the active user task', () => {
    const internalGoal: AgentGoal = {
      id: 'effect-memory-remember-request',
      title: 'Verify memory_remember effect',
      status: 'active',
      dependencies: [],
      evidence: [],
      createdAt: 1,
      updatedAt: 1,
      owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
      completionPolicy: 'blocking',
    };

    expect(resolveGraphTaskId({ goals: [internalGoal, ...goals] })).toBe('meal-plan');
  });

  it('builds working-block scope from graph state', () => {
    expect(
      resolveGraphWorkingBlockScope({
        conversationId: 'conv-scope',
        graphState: { goals, activeTaskId: 'meal-plan' },
      }),
    ).toEqual({
      conversationId: 'conv-scope',
      threadId: 'conv-scope',
      taskId: 'meal-plan',
    });
  });

  it('omits taskId when graph has no active task', () => {
    expect(
      resolveGraphWorkingBlockScope({
        conversationId: 'conv-scope',
        graphState: { goals: [] },
      }),
    ).toEqual({
      conversationId: 'conv-scope',
      threadId: 'conv-scope',
    });
  });
});
