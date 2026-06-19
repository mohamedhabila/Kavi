// ---------------------------------------------------------------------------
// Tests — Task Stack (working-block backed)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../../src/services/memory/schema';
import {
  readTaskStack,
  pushTask,
  popTask,
  activateTask,
  completeTask,
  getActiveTaskId,
  getActiveTaskTitle,
  pauseTask,
  upsertGoalTaskEntry,
} from '../../../src/services/memory/taskStack';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

describe('readTaskStack', () => {
  it('returns empty array when no stack exists', () => {
    expect(readTaskStack('conv-1')).toEqual([]);
  });

  it('returns entries in stack order', () => {
    const a = pushTask('conv-1', 'First task');
    const b = pushTask('conv-1', 'Second task');
    const stack = readTaskStack('conv-1');
    expect(stack).toHaveLength(2);
    expect(stack[0].id).toBe(a.id);
    expect(stack[1].id).toBe(b.id);
  });
});

describe('pushTask', () => {
  it('creates a new active task', () => {
    const task = pushTask('conv-1', 'Build the API');
    expect(task.title).toBe('Build the API');
    expect(task.state).toBe('active');
    expect(typeof task.id).toBe('string');
    expect(task.startedAt).toBeGreaterThan(0);
  });

  it('pauses the previous active task when pushing a new one', () => {
    const first = pushTask('conv-1', 'First');
    const second = pushTask('conv-1', 'Second');
    const stack = readTaskStack('conv-1');
    expect(stack[0].state).toBe('paused');
    expect(stack[1].state).toBe('active');
    expect(stack[0].id).toBe(first.id);
    expect(stack[1].id).toBe(second.id);
  });

  it('isolates stacks by conversation', () => {
    pushTask('conv-a', 'Task A');
    pushTask('conv-b', 'Task B');
    expect(readTaskStack('conv-a')).toHaveLength(1);
    expect(readTaskStack('conv-b')).toHaveLength(1);
    expect(readTaskStack('conv-a')[0].title).toBe('Task A');
    expect(readTaskStack('conv-b')[0].title).toBe('Task B');
  });
});

describe('popTask', () => {
  it('returns null when stack is empty', () => {
    expect(popTask('conv-1')).toBeNull();
  });

  it('removes and returns the top task', () => {
    const task = pushTask('conv-1', 'Top');
    const popped = popTask('conv-1');
    expect(popped?.id).toBe(task.id);
    expect(readTaskStack('conv-1')).toHaveLength(0);
  });

  it('reactivates the next task when popping an active task', () => {
    const first = pushTask('conv-1', 'First');
    pushTask('conv-1', 'Second');
    popTask('conv-1');
    const stack = readTaskStack('conv-1');
    expect(stack).toHaveLength(1);
    expect(stack[0].id).toBe(first.id);
    expect(stack[0].state).toBe('active');
  });

  it('does not change state of lower tasks when popping a paused task', () => {
    pushTask('conv-1', 'First');
    const second = pushTask('conv-1', 'Second');
    completeTask('conv-1', second.id);
    const popped = popTask('conv-1');
    expect(popped?.state).toBe('completed');
    expect(readTaskStack('conv-1')[0].state).toBe('active');
  });
});

describe('activateTask', () => {
  it('marks the specified task active and pauses others', () => {
    const first = pushTask('conv-1', 'First');
    const second = pushTask('conv-1', 'Second');
    expect(getActiveTaskId('conv-1')).toBe(second.id);

    activateTask('conv-1', first.id);
    const stack = readTaskStack('conv-1');
    expect(stack[0].state).toBe('active');
    expect(stack[1].state).toBe('paused');
  });

  it('is a no-op when taskId is not in stack', () => {
    pushTask('conv-1', 'Only');
    activateTask('conv-1', 'nonexistent');
    expect(readTaskStack('conv-1')[0].state).toBe('active');
  });
});

describe('completeTask', () => {
  it('marks the specified task as completed', () => {
    const task = pushTask('conv-1', 'Do thing');
    completeTask('conv-1', task.id);
    expect(readTaskStack('conv-1')[0].state).toBe('completed');
  });

  it('does not change other tasks', () => {
    const first = pushTask('conv-1', 'First');
    const second = pushTask('conv-1', 'Second');
    completeTask('conv-1', first.id);
    const stack = readTaskStack('conv-1');
    expect(stack[0].state).toBe('completed');
    expect(stack[1].id).toBe(second.id);
    expect(stack[1].state).toBe('active');
  });
});

describe('getActiveTaskId', () => {
  it('returns null when stack is empty', () => {
    expect(getActiveTaskId('conv-1')).toBeNull();
  });

  it('returns the active task id', () => {
    const task = pushTask('conv-1', 'Active');
    expect(getActiveTaskId('conv-1')).toBe(task.id);
  });

  it('returns the most recent active task when multiple exist', () => {
    pushTask('conv-1', 'First');
    const second = pushTask('conv-1', 'Second');
    expect(getActiveTaskId('conv-1')).toBe(second.id);
  });

  it('returns null when all tasks are completed', () => {
    const task = pushTask('conv-1', 'Done');
    completeTask('conv-1', task.id);
    expect(getActiveTaskId('conv-1')).toBeNull();
  });
});

describe('pauseTask', () => {
  it('marks the specified task paused without reactivating siblings', () => {
    upsertGoalTaskEntry('conv-1', 'goal-a', 'First', 'active', 100);
    upsertGoalTaskEntry('conv-1', 'goal-b', 'Second', 'active', 200);
    pauseTask('conv-1', 'goal-b', 300);
    const stack = readTaskStack('conv-1');
    expect(stack.find((entry) => entry.id === 'goal-a')?.state).toBe('paused');
    expect(stack.find((entry) => entry.id === 'goal-b')?.state).toBe('paused');
    expect(getActiveTaskId('conv-1')).toBeNull();
  });
});

describe('upsertGoalTaskEntry', () => {
  it('creates a goal-id task and pauses the previous active task', () => {
    pushTask('conv-1', 'Legacy');
    const goalTask = upsertGoalTaskEntry('conv-1', 'goal-a', 'trip-planning', 'active');
    const stack = readTaskStack('conv-1');
    expect(goalTask.id).toBe('goal-a');
    expect(stack[0].state).toBe('paused');
    expect(stack[1]).toMatchObject({ id: 'goal-a', title: 'trip-planning', state: 'active' });
  });

  it('reactivates an existing goal task and pauses the current active task', () => {
    upsertGoalTaskEntry('conv-1', 'goal-a', 'trip-planning', 'active', 100);
    upsertGoalTaskEntry('conv-1', 'goal-b', 'meal-planning', 'active', 200);
    upsertGoalTaskEntry('conv-1', 'goal-a', 'trip-planning', 'active', 300);
    expect(getActiveTaskTitle('conv-1')).toBe('trip-planning');
    const stack = readTaskStack('conv-1');
    expect(stack.find((entry) => entry.id === 'goal-b')?.state).toBe('paused');
    expect(stack.find((entry) => entry.id === 'goal-a')?.state).toBe('active');
  });
});

describe('getActiveTaskTitle', () => {
  it('returns null when no active task', () => {
    expect(getActiveTaskTitle('conv-1')).toBeNull();
  });

  it('returns the active task title', () => {
    pushTask('conv-1', 'Build API');
    expect(getActiveTaskTitle('conv-1')).toBe('Build API');
  });
});
