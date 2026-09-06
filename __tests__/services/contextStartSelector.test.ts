import type { Message } from '../../src/types/message';
import { selectContextStartIndex } from '../../src/services/context/contextStartSelector';

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id || `msg-${Math.random()}`,
    role: overrides.role || 'user',
    content: overrides.content || '',
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  };
}

describe('contextStartSelector', () => {
  it('returns full history for empty message sets', () => {
    const result = selectContextStartIndex([], { mode: 'chat' });

    expect(result.startIndex).toBe(0);
    expect(result.reason).toBe('full_history');
    expect(result.droppedMessageCount).toBe(0);
  });

  it('cuts to a topic boundary after a long idle gap, regardless of content overlap', () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'Debug docker compose deployment issue',
        timestamp: 1_000,
      }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Let us inspect logs first',
        timestamp: 2_000,
      }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'Write a poem about oceans and sunrise',
        timestamp: 30_000_000,
      }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 30_000_000,
      policyOverride: { hardIdleCutoffMs: 60_000 },
    });

    expect(result.startIndex).toBe(2);
    expect(result.reason).toBe('topic_shift_boundary');
    expect(result.droppedMessageCount).toBe(2);
  });

  it('anchors idle-gap detection to the previous user turn even when assistant chatter is recent', () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'Debug docker compose deployment issue',
        timestamp: 1_000,
      }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Interim update while waiting for logs',
        timestamp: 29_999_900,
      }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'Write a poem about oceans and sunrise',
        timestamp: 30_000_000,
      }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 30_000_000,
      policyOverride: { hardIdleCutoffMs: 60_000 },
    });

    expect(result.startIndex).toBe(2);
    expect(result.reason).toBe('topic_shift_boundary');
    expect(result.idleGapMs).toBe(29_999_000);
  });

  it('never drops history for a pronoun-only follow-up when the idle gap is short', () => {
    // No content-similarity heuristic runs anymore, so a near-content-free
    // follow-up like "What about that one?" must not trigger a cut on its own.
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'Compare the Q3 and Q4 marketing budgets for the Berlin office',
        timestamp: 1_000,
      }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Q3 was 120k and Q4 was 95k for the Berlin office.',
        timestamp: 2_000,
      }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'What about that one?',
        timestamp: 3_000,
      }),
    ];

    const result = selectContextStartIndex(messages, { mode: 'chat', now: 3_000 });

    expect(result.startIndex).toBe(0);
    expect(result.reason).toBe('full_history');
  });

  it('keeps full history for a short-idle-gap follow-up regardless of script', () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: '修复安卓发布版本启动崩溃',
        timestamp: 1_000,
      }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '正在检查启动路径',
        timestamp: 2_000,
      }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: '那个呢？',
        timestamp: 3_000,
      }),
    ];

    const result = selectContextStartIndex(messages, { mode: 'chat', now: 3_000 });

    expect(result.startIndex).toBe(0);
    expect(result.reason).toBe('full_history');
  });

  it('enforces max carryover user turns', () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'android crash fix startup release',
        timestamp: 1_000,
      }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'ok', timestamp: 2_000 }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'android crash fix startup release part two',
        timestamp: 3_000,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'ok', timestamp: 4_000 }),
      makeMessage({
        id: 'u3',
        role: 'user',
        content: 'android crash fix startup release final',
        timestamp: 5_000,
      }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 5_000,
      policyOverride: { maxCarryoverUserTurns: 1 },
    });

    expect(result.startIndex).toBe(2);
    expect(result.reason).toBe('carryover_limit');
  });

  it('never keeps more turns than minRecentUserTurns guarantees, even under a tighter carryover cap', () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'one', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'ok', timestamp: 2_000 }),
      makeMessage({ id: 'u2', role: 'user', content: 'two', timestamp: 3_000 }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 3_000,
      policyOverride: { maxCarryoverUserTurns: 0, minRecentUserTurns: 2 },
    });

    // minRecentUserTurns=2 guarantees both user turns survive even though
    // maxCarryoverUserTurns=0 would otherwise cut to the last turn only.
    expect(result.startIndex).toBe(0);
    expect(result.reason).toBe('full_history');
  });

  it('keeps bounded recent carryover for agentic one-conversation context', () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'I pasted a durable planning background for this ongoing mobile assistant thread',
        timestamp: 1_000,
      }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Acknowledged', timestamp: 2_000 }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'Now mention the errands preference from that background',
        timestamp: 3_000,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Done', timestamp: 4_000 }),
      makeMessage({
        id: 'u3',
        role: 'user',
        content: 'Switch briefly to family coordination and keep the earlier background available',
        timestamp: 5_000,
      }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'agentic',
      now: 5_000,
    });

    expect(result.startIndex).toBe(0);
    expect(result.reason).toBe('full_history');
  });

  it('pilot mode always forces a topic boundary, cutting to the minimum recent turns', () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'Old unrelated topic about travel plans',
        timestamp: 1_000,
      }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Travel response', timestamp: 2_000 }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'Workflow failed due to migration mismatch',
        timestamp: 3_000,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Investigating', timestamp: 4_000 }),
      makeMessage({
        id: 'u3',
        role: 'user',
        content: 'Still failing migration mismatch in workflow',
        timestamp: 5_000,
      }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'pilot',
      now: 5_000,
    });

    expect(result.startIndex).toBe(4);
    expect(result.reason).toBe('topic_shift_boundary');
    expect(result.droppedMessageCount).toBe(4);
  });
});
