jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import type { RecordFactInput } from '../../../src/services/memory/facts/types';
import { buildLivingMemorySections } from '../../../src/services/memory/livingMemoryBridge';
import { pushTask, completeTask } from '../../../src/services/memory/taskStack';
import type { Message } from '../../../src/types/message';

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

function userMessage(content: string, timestamp: number): Message {
  return { id: `u-${timestamp}`, role: 'user', content, timestamp } as Message;
}

function memoryScope(conversationId: string) {
  return {
    conversationId,
    sourceThreadId: conversationId,
    personaId: 'default',
    taskId: null,
  } as const;
}

function recordFact(input: RecordFactInput) {
  return recordFactWithApplicability(input, {
    factClass: 'workflow',
    sourceAuthority: 'tool_observed',
  });
}

describe('buildLivingMemorySections task context', () => {
  it('renders the explicitly authorized task title from the task stack', async () => {
    const task = pushTask('conv-task', 'Refactor the auth layer');
    const out = await buildLivingMemorySections({
      messages: [userMessage('continue', 1_000)],
      ...memoryScope('conv-task'),
      taskId: task.id,
      now: 2_000,
    });
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).toContain('Active task: Refactor the auth layer');
  });

  it('does not auto-promote a task from the task stack into recall scope', async () => {
    const me = upsertEntity({ name: 'user', type: 'self' });
    const taskA = pushTask('conv-scope', 'Task A');
    pushTask('conv-scope', 'Task B');

    // Fact scoped to Task A
    recordFact({
      subjectId: me.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
      sourceMessageId: null,
      sourceRunId: null,
      scope: 'session',
      originConversationId: 'conv-scope',
      originThreadId: 'conv-scope',
      originTaskId: taskA.id,
    });

    // Bridge should scope to active task (Task B), so Berlin fact should not appear
    const out = await buildLivingMemorySections({
      messages: [userMessage('Where do I live?', 1_000)],
      ...memoryScope('conv-scope'),
      now: 2_000,
    });

    const dynamicText = out.sections.map((section) => section.text).join('\n');
    expect(dynamicText).not.toContain('Active task: Task B');
    expect(dynamicText).not.toContain('Berlin');
  });

  it('explicit taskId overrides the task stack', async () => {
    pushTask('conv-override', 'Stack task');
    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      ...memoryScope('conv-override'),
      taskId: 'explicit-task-id',
      now: 2_000,
    });
    // The explicit taskId should be used; since no working block exists for it,
    // the active task title from the stack should not appear.
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).not.toContain('Stack task');
  });

  it('does not render active task when stack is empty', async () => {
    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      ...memoryScope('conv-empty'),
      now: 2_000,
    });
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).not.toContain('Active task:');
  });

  it('does not render active task when all tasks are completed', async () => {
    const task = pushTask('conv-done', 'Completed task');
    completeTask('conv-done', task.id);
    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      ...memoryScope('conv-done'),
      now: 2_000,
    });
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).not.toContain('Active task:');
  });
});
