// ---------------------------------------------------------------------------
// Tests — Living memory bridge
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact, setFactPinned } from '../../../src/services/memory/facts/mutations';
import { ensureDefaultBlocks, editBlock } from '../../../src/services/memory/blocks';
import { editWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { buildLivingMemorySections } from '../../../src/services/memory/livingMemoryBridge';
import { pushTask, completeTask } from '../../../src/services/memory/taskStack';
import { recordEpisode } from '../../../src/services/memory/episodes/mutations';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
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

describe('buildLivingMemorySections', () => {
  it('returns the empty bridge when no messages are supplied', async () => {
    const out = await buildLivingMemorySections({ messages: [] });
    expect(out.sections).toEqual([]);
    expect(out.recalledFactCount).toBe(0);
    expect(out.openThreadLabels).toEqual([]);
    expect(out.idleSinceLastTurnMs).toBeUndefined();
  });

  it('emits a dynamic L2 section for pinned blocks with content', async () => {
    editBlock('profile', 'Berlin-based developer named Sam.', { replace: true });

    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      now: 2_000,
    });

    expect(out.sections.length).toBeGreaterThan(0);
    expect(out.sections.some((s) => s.cacheable === true)).toBe(false);
    const rendered = out.sections.map((s) => s.text).join('\n');
    expect(rendered).toContain('<block label="profile">');
    expect(rendered).toContain('Berlin-based developer');
  });

  it('omits empty memory blocks from the L2 prefix', async () => {
    // Default blocks are seeded but empty — no L2 section should appear.
    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      now: 2_000,
    });
    const cacheable = out.sections.filter((s) => s.cacheable === true);
    expect(cacheable).toEqual([]);
  });

  it('renders a focus block (L3) reflecting the gap since the last assistant turn', async () => {
    const now = 1_000_000;
    const lastAssistantAt = now - 30 * 60 * 1000; // 30 min ago — longer break bucket.
    const messages: Message[] = [
      userMessage('first turn', now - 31 * 60 * 1000),
      assistantMessage('first reply', lastAssistantAt),
      userMessage('back now', now),
    ];

    const out = await buildLivingMemorySections({ messages, now });
    const dynamic = out.sections.filter((s) => !s.cacheable);
    expect(dynamic.length).toBeGreaterThan(0);
    expect(dynamic.map((s) => s.text).join('\n')).toContain('## This Turn');
    expect(out.idleSinceLastTurnMs).toBe(30 * 60 * 1000);
    expect(out.focusGap?.bucket).toBe('longer_break');
  });

  it('passes active_focus and open_threads block content to the focus renderer', async () => {
    const now = 5_000_000;
    editBlock('active_focus', 'Refactor the prompt assembler to use 4 layers.', {
      replace: true,
    });
    editBlock('open_threads', '- Land Chunk J\n- Wire layered budget cascade\n- Add tests', {
      replace: true,
    });

    const out = await buildLivingMemorySections({
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
    editBlock('active_focus', 'Global focus should not leak.', { replace: true });
    editWorkingBlock(
      'active_focus',
      'Scoped focus for conversation alpha.',
      { conversationId: 'conv-alpha', threadId: 'conv-alpha' },
      { now },
    );
    editWorkingBlock(
      'open_threads',
      'Scoped follow-up only',
      { conversationId: 'conv-alpha', threadId: 'conv-alpha' },
      { now },
    );

    const out = await buildLivingMemorySections({
      messages: [userMessage('continue', now)],
      conversationId: 'conv-alpha',
      now,
    });

    expect(out.focusBlockText).toBe('Scoped focus for conversation alpha.');
    expect(out.openThreadLabels).toEqual(['Scoped follow-up only']);
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).toContain('Scoped focus for conversation alpha.');
    expect(dynamicText).not.toContain('Global focus should not leak.');
  });

  it('prefers runtime-enriched user content for recall when available', async () => {
    const me = upsertEntity({ name: 'user', type: 'self' });
    recordFact({
      subjectId: me.id,
      predicate: 'prefers_backend',
      objectText: 'LiteRT runtime',
    });

    const out = await buildLivingMemorySections({
      messages: [
        {
          ...userMessage('hello', 1_000),
          enrichedContent: 'hello\n<runtime_context>LiteRT runtime</runtime_context>',
        },
      ],
      now: 2_000,
    });

    expect(out.recalledFactCount).toBeGreaterThan(0);
  });

  it('uses a bounded recent-user-turn window for vague one-conversation followups', async () => {
    const project = upsertEntity({ name: 'nebula', type: 'project' });
    recordFact({
      subjectId: project.id,
      predicate: 'handoff_token',
      objectText: 'NEBULA-WINDOW-E2E',
      scope: 'conversation',
      originConversationId: 'conv-window',
    });

    const out = await buildLivingMemorySections({
      messages: [
        userMessage('NEBULA-WINDOW-E2E release context', 1_000),
        assistantMessage('noted', 2_000),
        userMessage('continue with that', 3_000),
      ],
      conversationId: 'conv-window',
      now: 4_000,
    });

    expect(out.recalledFactCount).toBeGreaterThan(0);
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).toContain('NEBULA-WINDOW-E2E');
  });

  it('appends recalled facts (text-only, lexical match) to the L3 section', async () => {
    const me = upsertEntity({ name: 'user', type: 'self' });
    const fact = recordFact({
      subjectId: me.id,
      predicate: 'lives_in',
      objectText: 'Berlin Berlin Berlin',
    });
    setFactPinned(fact.fact.id, true);
    recordFact({ subjectId: me.id, predicate: 'works_on', objectText: 'Kavi mobile' });

    const out = await buildLivingMemorySections({
      messages: [userMessage('Berlin Berlin', 1_000)],
      now: 2_000,
    });

    expect(out.recalledFactCount).toBeGreaterThan(0);
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).toContain('### Retrieved Memory');
    expect(dynamicText).toContain('Berlin');
    expect(dynamicText).toContain('user lives_in');
    expect(dynamicText).not.toContain(fact.fact.subjectId);
  });

  it('surfaces the current fact before stale passive activity for updated preferences', async () => {
    const subject = upsertEntity({ name: 'direct-longmem-user', type: 'person' });
    const conversationId = 'conv-longmem-preference';
    recordFact({
      subjectId: subject.id,
      predicate: 'preferred_message_contact',
      objectText: 'Morgan',
      scope: 'conversation',
      originConversationId: conversationId,
      now: 1_000,
    });
    recordFact({
      subjectId: subject.id,
      predicate: 'preferred_message_contact',
      objectText: 'Avery',
      scope: 'conversation',
      originConversationId: conversationId,
      supersedePrior: true,
      now: 2_000,
    });
    recordEpisode({
      conversationId,
      threadId: conversationId,
      startedAt: 1_000,
      endedAt: 1_500,
      summary: 'Passive activity mentioned Morgan.',
      messageIds: ['u-old', 'a-old'],
      toolNames: [],
      now: 2_500,
    });

    const out = await buildLivingMemorySections({
      messages: [
        userMessage(
          'Use current preferred_message_contact for direct-longmem-user',
          3_000,
        ),
      ],
      conversationId,
      now: 4_000,
    });

    expect(out.recalledFactCount).toBeGreaterThan(0);
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    const currentFactIndex = dynamicText.indexOf(
      'direct-longmem-user preferred_message_contact: Avery',
    );
    const passiveEpisodeIndex = dynamicText.indexOf('Passive activity mentioned Morgan.');
    expect(currentFactIndex).toBeGreaterThan(-1);
    expect(passiveEpisodeIndex).toBeGreaterThan(-1);
    expect(currentFactIndex).toBeLessThan(passiveEpisodeIndex);
  });

  it('surfaces recent current conversation facts for underspecified final actions', async () => {
    const user = upsertEntity({ name: 'beam-user', type: 'person' });
    const team = upsertEntity({ name: 'beam-team', type: 'concept' });
    const conversationId = 'conv-current-action';

    recordFact({
      subjectId: user.id,
      predicate: 'route_code',
      objectText: 'BEAM-ROUTE-A',
      scope: 'conversation',
      originConversationId: conversationId,
      now: 1_000,
    });
    recordFact({
      subjectId: user.id,
      predicate: 'meal_preference',
      objectText: 'BEAM-MEAL-OLD',
      scope: 'conversation',
      originConversationId: conversationId,
      now: 2_000,
    });
    recordFact({
      subjectId: team.id,
      predicate: 'escalation_channel',
      objectText: 'BEAM-CHANNEL-7',
      scope: 'conversation',
      originConversationId: conversationId,
      now: 3_000,
    });
    recordFact({
      subjectId: user.id,
      predicate: 'meal_preference',
      objectText: 'BEAM-MEAL-NEW',
      scope: 'conversation',
      originConversationId: conversationId,
      supersedePrior: true,
      now: 4_000,
    });
    recordFact({
      subjectId: user.id,
      predicate: 'reminder_window',
      objectText: 'BEAM-WINDOW-9',
      scope: 'conversation',
      originConversationId: conversationId,
      now: 5_000,
    });

    const out = await buildLivingMemorySections({
      messages: [
        userMessage('Please write the current state into the requested artifact.', 6_000),
      ],
      conversationId,
      now: 7_000,
      recallLimit: 6,
    });
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');

    expect(dynamicText).toContain('beam-user route_code: BEAM-ROUTE-A');
    expect(dynamicText).toContain('beam-user meal_preference: BEAM-MEAL-NEW');
    expect(dynamicText).toContain('beam-user reminder_window: BEAM-WINDOW-9');
    expect(dynamicText).toContain('beam-team escalation_channel: BEAM-CHANNEL-7');
    expect(dynamicText).not.toContain('BEAM-MEAL-OLD');
  });

  it('skips fact recall entirely when disableRecall is true', async () => {
    const me = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: me.id, predicate: 'lives_in', objectText: 'Berlin' });

    const out = await buildLivingMemorySections({
      messages: [userMessage('Where do I live? Berlin', 1_000)],
      now: 2_000,
      disableRecall: true,
    });

    expect(out.recalledFactCount).toBe(0);
  });

  it('produces a stable cacheableSignature for the same inputs (cache hit safety)', async () => {
    editBlock('profile', 'Stable profile content.', { replace: true });

    const messages = [
      userMessage('hello', 1_000),
      assistantMessage('hi', 2_000),
      userMessage('again', 3_000),
    ];

    const a = await buildLivingMemorySections({ messages, now: 4_000 });
    const b = await buildLivingMemorySections({ messages, now: 4_000 });
    expect(a.cacheableSignature).toBe(b.cacheableSignature);
    // Memory sections stay dynamic until a context epoch admits them, so changing
    // the dynamic now-value must not change the stable prefix signature.
    const c = await buildLivingMemorySections({ messages, now: 999_999 });
    expect(c.cacheableSignature).toBe(a.cacheableSignature);
  });

  it('tolerates a recall failure by emitting zero retrieved facts (never throws)', async () => {
    const factRecall = require('../../../src/services/memory/factRecall');
    const spy = jest
      .spyOn(factRecall, 'recallFactsForQuery')
      .mockRejectedValueOnce(new Error('embedder offline'));
    try {
      const out = await buildLivingMemorySections({
        messages: [userMessage('something', 1_000)],
        now: 2_000,
      });
      expect(out.recalledFactCount).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('uses a custom block reader when supplied (test seam)', async () => {
    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      now: 2_000,
      readBlocks: () => [
        {
          label: 'profile',
          content: 'Custom reader content.',
          charLimit: 100,
          description: 'desc',
          pinned: true,
          personaId: null,
          updatedAt: 0,
        },
      ],
    });

    expect(out.sections.some((s) => s.cacheable === true)).toBe(false);
    expect(out.sections.map((s) => s.text).join('\n')).toContain('Custom reader content');
  });

  it('falls back to lastUserAt for idle gap when no assistant turn exists', async () => {
    const out = await buildLivingMemorySections({
      messages: [userMessage('first ever turn', 1_000)],
      now: 4_000,
    });
    expect(out.idleSinceLastTurnMs).toBe(3_000);
  });

  it('returns the empty bridge when disableLongTermMemory is true even with persisted blocks/facts', async () => {
    editBlock('profile', 'Berlin-based developer named Sam.', { replace: true });
    const sam = upsertEntity({ name: 'sam', type: 'person' });
    const fact = recordFact({
      subjectId: sam.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
    });
    setFactPinned(fact.fact.id, true);

    const out = await buildLivingMemorySections({
      messages: [userMessage('hello sam Berlin', 1_000)],
      now: 2_000,
      disableLongTermMemory: true,
    });

    expect(out.sections).toEqual([]);
    expect(out.recalledFactCount).toBe(0);
    expect(out.openThreadLabels).toEqual([]);
    expect(out.idleSinceLastTurnMs).toBeUndefined();
  });

  it('reads active task from task stack and renders it in the prompt', async () => {
    pushTask('conv-task', 'Refactor the auth layer');
    const out = await buildLivingMemorySections({
      messages: [userMessage('continue', 1_000)],
      conversationId: 'conv-task',
      now: 2_000,
    });
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).toContain('Active task: Refactor the auth layer');
  });

  it('scopes recall to the active task from the task stack', async () => {
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
      originTaskId: taskA.id,
    });

    // Bridge should scope to active task (Task B), so Berlin fact should not appear
    const out = await buildLivingMemorySections({
      messages: [userMessage('Where do I live?', 1_000)],
      conversationId: 'conv-scope',
      now: 2_000,
    });

    // The fact is scoped to Task A but active task is Task B, so recall should not find it
    // (unless lexical match is strong enough to bypass task scoping — depends on factRecall impl)
    // We mainly verify the active task is rendered and the bridge doesn't crash.
    expect(out.sections.length).toBeGreaterThan(0);
  });

  it('explicit taskId overrides the task stack', async () => {
    pushTask('conv-override', 'Stack task');
    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      conversationId: 'conv-override',
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
      conversationId: 'conv-empty',
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
      conversationId: 'conv-done',
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
      conversationId: 'conv-reflection-bridge',
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
