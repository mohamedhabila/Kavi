jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { orchestrateMemoryRetrieval } from '../../../src/services/memory/retrievalOrchestrator';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import {
  getMemoryTask,
  listMemoryTasks,
  syncActiveGoalFocusFromGraphTransition,
  syncActiveTaskFromGoal,
  syncGoalTasksFromMutation,
} from '../../../src/services/memory/tasks';
import { getActiveTaskTitle } from '../../../src/services/memory/taskStack';
import { editWorkingBlock, getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import type { AgentGoal } from '../../../src/engine/goals/types';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('goals/memoryGraphIntegration', () => {
  it('includes active goal titles in retrieval query signals', async () => {
    const goals: AgentGoal[] = [
      {
        id: 'goal-1',
        title: 'Book flights',
        description: 'Find nonstop options',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
        requiredCapabilities: ['web_search'],
      },
    ];

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'any updates?',
      goals,
      activeTaskId: 'goal-1',
      conversationId: 'conv-1',
      limit: 4,
    });

    expect(result.querySignals).toEqual(
      expect.arrayContaining(['any updates?', 'Book flights', 'Find nonstop options', 'web_search']),
    );
  });

  it('mirrors update_goals mutations into memory_tasks and task_stack', () => {
    let goals = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          {
            id: 'goal-a',
            title: 'Audit repository',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:read_file'],
          },
        ],
      },
      100,
    ).goals;
    syncGoalTasksFromMutation({
      threadId: 'conv-1',
      mutation: {
        action: 'add',
        goals: [
          {
            id: 'goal-a',
            title: 'Audit repository',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:read_file'],
          },
        ],
      },
      goals,
      now: 100,
    });
    expect(getActiveTaskTitle('conv-1')).toBe('Audit repository');

    const addB = applyGoalMutation(
      goals,
      {
        action: 'add',
        goals: [
          {
            id: 'goal-b',
            title: 'Apply fix',
            status: 'pending',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:write_file'],
          },
        ],
      },
      150,
    );
    goals = addB.goals;
    syncGoalTasksFromMutation({
      threadId: 'conv-1',
      mutation: {
        action: 'add',
        goals: [
          {
            id: 'goal-b',
            title: 'Apply fix',
            status: 'pending',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:write_file'],
          },
        ],
      },
      goals,
      now: 150,
    });

    const activateB = applyGoalMutation(
      goals,
      { action: 'activate', goals: [{ id: 'goal-b' }] },
      200,
    );
    goals = activateB.goals;
    syncGoalTasksFromMutation({
      threadId: 'conv-1',
      mutation: { action: 'activate', goals: [{ id: 'goal-b' }] },
      goals,
      now: 200,
    });

    expect(getActiveTaskTitle('conv-1')).toBe('Apply fix');
    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
      taskId: 'goal-b',
    })?.content).toBe('Apply fix');
    expect(getMemoryTask('goal-b')).toMatchObject({
      threadId: 'conv-1',
      title: 'Apply fix',
      state: 'active',
    });
    expect(getMemoryTask('goal-a')).toMatchObject({
      state: 'paused',
    });
  });

  it('marks memory_tasks completed when a graph goal is completed', () => {
    let goals = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          {
            id: 'goal-a',
            title: 'Ship feature',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:write_file'],
          },
        ],
      },
      100,
    ).goals;
    syncGoalTasksFromMutation({
      threadId: 'conv-1',
      mutation: {
        action: 'add',
        goals: [
          {
            id: 'goal-a',
            title: 'Ship feature',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.prefix:write_file'],
          },
        ],
      },
      goals,
      now: 100,
    });

    const completed = applyGoalMutation(
      goals,
      { action: 'complete', goals: [{ id: 'goal-a', evidence: ['write_file:artifacts/e2e.txt'] }] },
      200,
    );
    goals = completed.goals;
    syncGoalTasksFromMutation({
      threadId: 'conv-1',
      mutation: { action: 'complete', goals: [{ id: 'goal-a' }] },
      goals,
      now: 200,
    });

    expect(getMemoryTask('goal-a')).toMatchObject({
      threadId: 'conv-1',
      title: 'Ship feature',
      state: 'completed',
    });
  });

  it('syncs active_focus when the active goal changes via graph transition hook', () => {
    let goals = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          {
            id: 'scope-a',
            title: 'scope-a-planning',
            status: 'active',
            completionPolicy: 'persistent',
          },
        ],
      },
      100,
    ).goals;
    syncActiveGoalFocusFromGraphTransition({
      threadId: 'conv-1',
      goals,
      now: 100,
    });
    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
      taskId: 'scope-a',
    })?.content).toBe('scope-a-planning');

    const switched = applyGoalMutation(
      goals,
      {
        action: 'add',
        goals: [
          {
            id: 'scope-b',
            title: 'scope-b-planning',
            status: 'active',
            completionPolicy: 'persistent',
          },
        ],
      },
      200,
    );
    goals = switched.goals;
    syncActiveGoalFocusFromGraphTransition({
      threadId: 'conv-1',
      goals,
      now: 200,
    });

    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
      taskId: 'scope-b',
    })?.content).toBe('scope-b-planning');
  });

  it('repairs active_focus when the active graph goal id is unchanged', () => {
    const goals = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          {
            id: 'scope-b',
            title: 'scope-b-planning',
            status: 'active',
            completionPolicy: 'persistent',
          },
        ],
      },
      100,
    ).goals;

    syncActiveGoalFocusFromGraphTransition({
      threadId: 'conv-1',
      goals,
      now: 200,
    });

    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
      taskId: 'scope-b',
    })?.content).toBe('scope-b-planning');
  });

  it('overwrites stale active_focus from the graph-owned active goal', () => {
    const goals = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          {
            id: 'scope-b',
            title: 'scope-b-planning',
            status: 'active',
            completionPolicy: 'persistent',
          },
        ],
      },
      100,
    ).goals;
    editWorkingBlock(
      'active_focus',
      'scope-a-planning',
      {
        conversationId: 'conv-1',
        threadId: 'conv-1',
        taskId: 'scope-b',
      },
      { now: 150 },
    );

    syncActiveGoalFocusFromGraphTransition({
      threadId: 'conv-1',
      goals,
      now: 200,
    });

    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
      taskId: 'scope-b',
    })?.content).toBe('scope-b-planning');
  });

  it('syncs the active goal into memory_tasks and pauses prior active tasks', () => {
    syncActiveTaskFromGoal({
      threadId: 'conv-1',
      goalId: 'goal-a',
      goalTitle: 'Audit repository',
      now: 100,
    });
    syncActiveTaskFromGoal({
      threadId: 'conv-1',
      goalId: 'goal-b',
      goalTitle: 'Apply fix',
      now: 200,
    });

    expect(getMemoryTask('goal-b')).toMatchObject({
      threadId: 'conv-1',
      title: 'Apply fix',
      state: 'active',
    });
    expect(getMemoryTask('goal-a')).toMatchObject({
      state: 'paused',
    });
    expect(listMemoryTasks('conv-1').map((task) => task.id)).toEqual(
      expect.arrayContaining(['goal-a', 'goal-b']),
    );
  });

  it('composes active_focus from graph goal title and conversation title when both are available', () => {
    syncActiveTaskFromGoal({
      threadId: 'conv-1',
      goalId: 'goal-a',
      goalTitle: 'longmem-delayed-recall',
      threadTitle: 'longmem-delayed-thread',
      now: 100,
    });

    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
      taskId: 'goal-a',
    })?.content).toBe('longmem-delayed-recall\nlongmem-delayed-thread');
  });
});
