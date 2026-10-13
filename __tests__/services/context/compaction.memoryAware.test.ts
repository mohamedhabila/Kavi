// ---------------------------------------------------------------------------
// Tests — Memory-aware compaction
// ---------------------------------------------------------------------------

import { DefaultCompactionEngine } from '../../../src/services/context/compaction';
import { buildStructuredSummary } from '../../../src/services/context/compactionSummary';
import type { Message } from '../../../src/types/message';

jest.mock('../../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
}));

const makeMsg = (
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  extra: Partial<Message> = {},
): Message => ({
  id: `msg-${Math.random()}`,
  role,
  content,
  timestamp: Date.now(),
  attachments: [],
  ...extra,
});

describe('buildStructuredSummary — memory-aware hints', () => {
  const messages: Message[] = [
    makeMsg('user', 'Refactor the auth module to use bcrypt directly.'),
    makeMsg('assistant', 'Decided to swap Passlib for argon2-cffi.'),
  ];

  it('appends an Open Threads section when threads are provided', () => {
    const summary = buildStructuredSummary(messages, 'selective', undefined, {
      openThreads: ['Switch hashing algo', 'Audit existing user records'],
    });
    expect(summary).toContain('## Open Threads');
    expect(summary).toContain('- Switch hashing algo');
    expect(summary).toContain('- Audit existing user records');
  });

  it('caps open thread count tighter under aggressive tier', () => {
    const threads = Array.from({ length: 12 }, (_, i) => `thread-${i}`);
    const aggressive = buildStructuredSummary(messages, 'aggressive', undefined, {
      openThreads: threads,
    });
    const selective = buildStructuredSummary(messages, 'selective', undefined, {
      openThreads: threads,
    });
    // aggressive cap = 4, selective cap = 8
    const aggressiveCount = (aggressive.match(/^- thread-/gm) ?? []).length;
    const selectiveCount = (selective.match(/^- thread-/gm) ?? []).length;
    expect(aggressiveCount).toBe(4);
    expect(selectiveCount).toBe(8);
  });

  it('omits memory sections when no hints are passed', () => {
    const summary = buildStructuredSummary(messages, 'selective');
    expect(summary).not.toContain('## Open Threads');
  });

  it('ignores blank threads', () => {
    const summary = buildStructuredSummary(messages, 'selective', undefined, {
      openThreads: ['', '  '],
    });
    expect(summary).not.toContain('## Open Threads');
  });
});

describe('DefaultCompactionEngine.compact — memory-aware summaries', () => {
  const engine = new DefaultCompactionEngine();

  // Build a summary-eligible payload: many non-system messages so the
  // tail-windowing code in `applySummarizationCompaction` has something to
  // summarize.
  const buildMessages = (count: number): Message[] =>
    Array.from({ length: count }, (_, i) =>
      makeMsg(i % 2 === 0 ? 'user' : 'assistant', `turn-${i} ${'word '.repeat(20)}`),
    );

  it('forwards open threads into the produced summary', async () => {
    const result = await engine.compact({
      sessionId: 's1',
      messages: buildMessages(40),
      tier: 'selective',
      compactionContext: { openThreads: ['confirm migration', 'update locales'] },
    });
    expect(result.compacted).toBe(true);
    const summary = result.result?.summary ?? '';
    expect(summary).toContain('## Open Threads');
    expect(summary).toContain('- confirm migration');
  });

  it('preserves the user-turn tail (never rewrites the kept tail)', async () => {
    // The kept-tail rule is enforced by applySummarizationCompaction returning
    // `firstKeptEntryId` — the orchestrator drops everything before it. Verify
    // the boundary is set and corresponds to a non-summarized message.
    const messages = buildMessages(40);
    const result = await engine.compact({
      sessionId: 's1',
      messages,
      tier: 'aggressive',
    });
    expect(result.compacted).toBe(true);
    const firstKept = result.result?.firstKeptEntryId;
    expect(firstKept).toBeTruthy();
    const keptIndex = messages.findIndex((m) => m.id === firstKept);
    // Aggressive keeps roughly the last 4-8 messages; the kept boundary must
    // sit comfortably in the tail half of the conversation.
    expect(keptIndex).toBeGreaterThan(messages.length / 2);
    // The very last message must be retained (it is the user-turn tail).
    expect(keptIndex).toBeLessThanOrEqual(messages.length - 1);
  });
});
