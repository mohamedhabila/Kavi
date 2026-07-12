// ---------------------------------------------------------------------------
// Tests — Living memory bridge
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import * as memoryDatabase from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  recordFactWithApplicability,
  setFactPinned,
} from '../../../src/services/memory/facts/mutations';
import type { RecordFactInput } from '../../../src/services/memory/facts/types';
import { editPromptEligibleWorkingBlock } from '../../../src/services/memory/workingBlocks';
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

function userMessage(content: string, timestamp: number): Message {
  return {
    id: `u-${timestamp}`,
    role: 'user',
    content,
    timestamp,
  } as Message;
}

function assistantMessage(content: string, timestamp: number): Message {
  return {
    id: `a-${timestamp}`,
    role: 'assistant',
    content,
    timestamp,
  } as Message;
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

describe('buildLivingMemorySections', () => {
  it('returns the empty bridge when no messages are supplied', async () => {
    const out = await buildLivingMemorySections({
      messages: [],
      ...memoryScope('conv-empty'),
    });
    expect(out.sections).toEqual([]);
    expect(out.recalledFactCount).toBe(0);
    expect(out.openThreadLabels).toEqual([]);
    expect(out.idleSinceLastTurnMs).toBeUndefined();
  });

  it('renders a focus block (L3) reflecting the gap since the last assistant turn', async () => {
    const now = 1_000_000;
    const lastAssistantAt = now - 30 * 60 * 1000; // 30 min ago — longer break bucket.
    const messages: Message[] = [
      userMessage('first turn', now - 31 * 60 * 1000),
      assistantMessage('first reply', lastAssistantAt),
      userMessage('back now', now),
    ];

    const out = await buildLivingMemorySections({
      messages,
      ...memoryScope('conv-focus-gap'),
      now,
    });
    const dynamic = out.sections.filter((s) => !s.cacheable);
    expect(dynamic.length).toBeGreaterThan(0);
    expect(dynamic.map((s) => s.text).join('\n')).toContain('## This Turn');
    expect(out.idleSinceLastTurnMs).toBe(30 * 60 * 1000);
    expect(out.focusGap?.bucket).toBe('longer_break');
  });

  it('passes exact-thread working focus and open threads to the focus renderer', async () => {
    const now = 5_000_000;
    editPromptEligibleWorkingBlock(
      'active_focus',
      'Refactor the prompt assembler to use 4 layers.',
      { conversationId: 'conv-focus-blocks', threadId: 'conv-focus-blocks' },
      { now },
    );
    editPromptEligibleWorkingBlock(
      'open_threads',
      '- Land Chunk J\n- Wire layered budget cascade\n- Add tests',
      { conversationId: 'conv-focus-blocks', threadId: 'conv-focus-blocks' },
      { now },
    );

    const out = await buildLivingMemorySections({
      ...memoryScope('conv-focus-blocks'),
      messages: [
        userMessage('q1', now - 60 * 60 * 1000),
        assistantMessage('a1', now - 50 * 60 * 1000),
        userMessage('continue', now),
      ],
      now,
    });

    expect(out.focusBlockText).toContain('Refactor the prompt assembler');
    expect(out.openThreadLabels).toEqual([
      'Land Chunk J',
      'Wire layered budget cascade',
      'Add tests',
    ]);
    const dynamic = out.sections.filter((s) => !s.cacheable);
    const dynamicText = dynamic.map((s) => s.text).join('\n');
    expect(dynamicText).toContain('Refactor the prompt assembler');
  });

  it('uses scoped working focus/open threads when a conversation id is supplied', async () => {
    const now = 5_000_000;
    editPromptEligibleWorkingBlock(
      'active_focus',
      'Other conversation focus should not leak.',
      { conversationId: 'conv-other', threadId: 'conv-other' },
      { now },
    );
    editPromptEligibleWorkingBlock(
      'active_focus',
      'Scoped focus for conversation alpha.',
      { conversationId: 'conv-alpha', threadId: 'conv-alpha' },
      { now },
    );
    editPromptEligibleWorkingBlock(
      'open_threads',
      'Scoped follow-up only',
      { conversationId: 'conv-alpha', threadId: 'conv-alpha' },
      { now },
    );

    const out = await buildLivingMemorySections({
      messages: [userMessage('continue', now)],
      ...memoryScope('conv-alpha'),
      now,
    });

    expect(out.focusBlockText).toBe('Scoped focus for conversation alpha.');
    expect(out.openThreadLabels).toEqual(['Scoped follow-up only']);
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).toContain('Scoped focus for conversation alpha.');
    expect(dynamicText).not.toContain('Other conversation focus should not leak.');
  });

  it('falls back to lastUserAt for idle gap when no assistant turn exists', async () => {
    const out = await buildLivingMemorySections({
      ...memoryScope('conv-idle-gap'),
      messages: [userMessage('first ever turn', 1_000)],
      now: 4_000,
    });
    expect(out.idleSinceLastTurnMs).toBe(3_000);
  });

  it('returns the empty bridge when disableLongTermMemory is true even with persisted facts', async () => {
    const sam = upsertEntity({ name: 'sam', type: 'person' });
    const fact = recordFact({
      subjectId: sam.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
      scope: 'global',
    });
    setFactPinned(fact.fact.id, true);

    const databaseSpy = jest.spyOn(memoryDatabase, 'getMemoryDb');
    const out = await buildLivingMemorySections({
      ...memoryScope('conv-opt-out'),
      messages: [userMessage('hello sam Berlin', 1_000)],
      now: 2_000,
      disableLongTermMemory: true,
    });

    expect(out.sections).toEqual([]);
    expect(out.recalledFactCount).toBe(0);
    expect(out.openThreadLabels).toEqual([]);
    expect(out.idleSinceLastTurnMs).toBeUndefined();
    expect(out.retrievalEvent).toBeUndefined();
    expect(databaseSpy).not.toHaveBeenCalled();
    databaseSpy.mockRestore();
  });

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

  it('injects the daily reflection block into L3 when a reflection exists', async () => {
    const reflectionContent = 'episode:ep-1 Created configs/nebula/runtime.json';
    const out = await buildLivingMemorySections({
      messages: [userMessage('continue', 1_000)],
      ...memoryScope('conv-reflection-bridge'),
      now: 2_000,
      readLatestReflection: () => reflectionContent,
    });
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).toContain('### Day Focus');
    expect(dynamicText).toContain(reflectionContent);
  });
});
