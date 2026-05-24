import type { Message } from '../../src/types';
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

  it('cuts to a new topic boundary after long idle gap', () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Debug docker compose deployment issue', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Let us inspect logs first', timestamp: 2_000 }),
      makeMessage({ id: 'u2', role: 'user', content: 'Write a poem about oceans and sunrise', timestamp: 30_000_000 }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 30_000_000,
      policyOverride: {
        hardIdleCutoffMs: 60_000,
        semanticSimilarityThreshold: 0.2,
      },
    });

    expect(result.startIndex).toBe(2);
    expect(result.reason).toBe('topic_shift_boundary');
    expect(result.droppedMessageCount).toBe(2);
  });

  it('anchors idle-gap detection to the previous user turn even when assistant chatter is recent', () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Debug docker compose deployment issue', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Interim update while waiting for logs', timestamp: 29_999_900 }),
      makeMessage({ id: 'u2', role: 'user', content: 'Write a poem about oceans and sunrise', timestamp: 30_000_000 }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 30_000_000,
      policyOverride: {
        hardIdleCutoffMs: 60_000,
        semanticSimilarityThreshold: 0.2,
      },
    });

    expect(result.startIndex).toBe(2);
    expect(result.reason).toBe('topic_shift_boundary');
    expect(result.idleGapMs).toBe(29_999_000);
  });

  it('keeps same-topic carryover even after idle when similarity stays high', () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Fix android release crash in startup flow', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Checking startup traces', timestamp: 2_000 }),
      makeMessage({ id: 'u2', role: 'user', content: 'Also fix android startup crash regression in release build', timestamp: 40_000_000 }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 40_000_000,
      policyOverride: {
        hardIdleCutoffMs: 60_000,
        semanticSimilarityThreshold: 0.1,
      },
    });

    expect(result.startIndex).toBe(0);
    expect(result.reason).toBe('full_history');
  });

  it('enforces max carryover user turns', () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'android crash fix startup release', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'ok', timestamp: 2_000 }),
      makeMessage({ id: 'u2', role: 'user', content: 'android crash fix startup release part two', timestamp: 3_000 }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'ok', timestamp: 4_000 }),
      makeMessage({ id: 'u3', role: 'user', content: 'android crash fix startup release final', timestamp: 5_000 }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 5_000,
      policyOverride: {
        semanticSimilarityThreshold: 0.01,
        maxCarryoverUserTurns: 1,
      },
    });

    expect(result.startIndex).toBe(2);
    expect(result.reason).toBe('carryover_limit');
  });

  it('cuts pilot transcript to latest relevant turn when stale context is unrelated', () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Old unrelated topic about travel plans', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Travel response', timestamp: 2_000 }),
      makeMessage({ id: 'u2', role: 'user', content: 'Workflow failed due to migration mismatch', timestamp: 3_000 }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Investigating', timestamp: 4_000 }),
      makeMessage({ id: 'u3', role: 'user', content: 'Still failing migration mismatch in workflow', timestamp: 5_000 }),
    ];

    const result = selectContextStartIndex(messages, {
      mode: 'pilot',
      now: 5_000,
      policyOverride: {
        semanticSimilarityThreshold: 0.3,
      },
    });

    expect(result.startIndex).toBe(2);
    expect(result.reason).toBe('topic_shift_boundary');
  });
});
