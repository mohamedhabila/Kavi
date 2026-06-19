import {
  resolveGraphTaskId,
  resolveGraphWorkingBlockScope,
} from '../../src/engine/goals/graphTaskScope';
import type { AgentGoal } from '../../src/engine/goals/types';

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
