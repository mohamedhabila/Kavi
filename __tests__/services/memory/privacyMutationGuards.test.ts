jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { subscribeToMemoryChanges } from '../../../src/services/memory/changeNotifications';
import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { completeTask, pushTask, readTaskStack } from '../../../src/services/memory/taskStack';
import { getMemoryTask, upsertMemoryTask } from '../../../src/services/memory/tasks';
import {
  clearWorkingBlock,
  editWorkingBlock,
  getWorkingBlock,
} from '../../../src/services/memory/workingBlocks';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const THREAD_ID = 'privacy-guard-thread';
const FOCUS_SCOPE = { conversationId: THREAD_ID, threadId: THREAD_ID } as const;

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('durable memory privacy mutation guards', () => {
  it('rejects direct writes while keeping reads and explicit block cleanup available', () => {
    const existing = pushTask(THREAD_ID, 'Existing goal');
    upsertMemoryTask({
      id: 'goal-existing',
      threadId: THREAD_ID,
      title: 'Existing goal',
      state: 'active',
      now: 100,
    });
    editWorkingBlock('active_focus', 'Existing focus', FOCUS_SCOPE, { now: 100 });

    useSettingsStore.setState({ disableLongTermMemory: true });

    expect(() =>
      editWorkingBlock('active_focus', 'Private replacement', FOCUS_SCOPE, { now: 200 }),
    ).toThrow('memory_disabled');
    expect(() =>
      upsertMemoryTask({
        id: 'goal-existing',
        threadId: THREAD_ID,
        title: 'Private replacement',
        now: 200,
      }),
    ).toThrow('memory_disabled');

    const taskStackMutations = [
      () => pushTask(THREAD_ID, 'Private new task'),
      () => completeTask(THREAD_ID, existing.id),
    ];
    for (const mutate of taskStackMutations) {
      expect(mutate).toThrow('memory_disabled');
    }

    expect(getWorkingBlock('active_focus', FOCUS_SCOPE)?.content).toBe('Existing focus');
    expect(getMemoryTask('goal-existing')).toMatchObject({
      title: 'Existing goal',
      state: 'active',
      updatedAt: 100,
    });
    expect(readTaskStack(THREAD_ID)).toEqual([
      expect.objectContaining({ id: existing.id, title: 'Existing goal', state: 'active' }),
    ]);

    expect(clearWorkingBlock('active_focus', FOCUS_SCOPE, 300)).toBe(true);
    expect(getWorkingBlock('active_focus', FOCUS_SCOPE)?.content).toBe('');
    expect(clearWorkingBlock('task_stack', FOCUS_SCOPE, 300)).toBe(true);
    expect(readTaskStack(THREAD_ID)).toEqual([]);
  });

  it('emits task and cleanup notifications only after their transaction commits', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(() =>
      runMemoryTransaction(() => {
        upsertMemoryTask({
          id: 'rolled-back-task',
          threadId: THREAD_ID,
          title: 'Rolled back task',
          now: 100,
        });
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(getMemoryTask('rolled-back-task')).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    runMemoryTransaction(() => {
      upsertMemoryTask({
        id: 'committed-task',
        threadId: THREAD_ID,
        title: 'Committed task',
        now: 200,
      });
    });
    expect(listener).toHaveBeenCalledTimes(1);

    editWorkingBlock('active_focus', 'Keep until committed', FOCUS_SCOPE, { now: 300 });
    listener.mockClear();

    expect(() =>
      runMemoryTransaction(() => {
        clearWorkingBlock('active_focus', FOCUS_SCOPE, 400);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(getWorkingBlock('active_focus', FOCUS_SCOPE)?.content).toBe('Keep until committed');
    expect(listener).not.toHaveBeenCalled();

    runMemoryTransaction(() => {
      clearWorkingBlock('active_focus', FOCUS_SCOPE, 500);
    });
    expect(getWorkingBlock('active_focus', FOCUS_SCOPE)?.content).toBe('');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
