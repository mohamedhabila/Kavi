// ---------------------------------------------------------------------------
// Tests — Task Stack (working-block backed)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  readTaskStack,
  pushTask,
  completeTask,
  getActiveTaskTitle,
} from '../../../src/services/memory/taskStack';
import { closeMemoryDb } from '../../../src/services/memory/database';

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

describe('getActiveTaskTitle', () => {
  it('returns null when no active task', () => {
    expect(getActiveTaskTitle('conv-1')).toBeNull();
  });

  it('returns the active task title', () => {
    pushTask('conv-1', 'Build API');
    expect(getActiveTaskTitle('conv-1')).toBe('Build API');
  });
});
