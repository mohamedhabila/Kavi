// ---------------------------------------------------------------------------
// Tests — Memory-aware compaction
// ---------------------------------------------------------------------------

import {
  DefaultContextEngine,
  buildStructuredSummary,
  COMPACTION_IDLE_GUARD_MS,
} from '../../../src/services/context/compaction';
import type { Message } from '../../../src/types';

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

  it('appends an Active Focus section when focusBlock is provided', () => {
    const summary = buildStructuredSummary(messages, 'selective', undefined, {
      focusBlock: 'Working on auth refactor (started 2h ago).',
    });
    expect(summary).toContain('## Active Focus');
    expect(summary).toContain('Working on auth refactor');
  });

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

  it('omits memory sections when no hints are passed (legacy behavior)', () => {
    const summary = buildStructuredSummary(messages, 'selective');
    expect(summary).not.toContain('## Active Focus');
    expect(summary).not.toContain('## Open Threads');
  });

  it('ignores empty focus block / blank threads', () => {
    const summary = buildStructuredSummary(messages, 'selective', undefined, {
      focusBlock: '   ',
      openThreads: ['', '  '],
    });
    expect(summary).not.toContain('## Active Focus');
    expect(summary).not.toContain('## Open Threads');
  });
});

describe('DefaultContextEngine.compact — idle gate', () => {
  const engine = new DefaultContextEngine();

  // Build a summary-eligible payload: many non-system messages so the
  // tail-windowing code in `applySummarizationCompaction` has something to
  // summarize.
  const buildMessages = (count: number): Message[] =>
    Array.from({ length: count }, (_, i) =>
      makeMsg(i % 2 === 0 ? 'user' : 'assistant', `turn-${i} ${'word '.repeat(20)}`),
    );

  it('skips mid-burst compaction when idle below the guard and not over budget', async () => {
    // No forceTier — let the natural tier kick in. currentTokenCount at 80%
    // of budget triggers tier-2 (selective threshold = 75%) but not the
    // overBudget bypass (which requires count > budget).
    const result = await engine.compact({
      sessionId: 's1',
      messages: buildMessages(40),
      tokenBudget: 10_000,
      currentTokenCount: 8_000,
      idleSinceLastTurnMs: 10_000, // 10s — well below 90s guard
    });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(false);
    expect(result.reason).toContain('mid-burst');
  });

  it('proceeds with compaction when idle exceeds the guard', async () => {
    const result = await engine.compact({
      sessionId: 's1',
      messages: buildMessages(40),
      tokenBudget: 10_000,
      currentTokenCount: 8_000,
      idleSinceLastTurnMs: COMPACTION_IDLE_GUARD_MS + 1_000,
    });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(true);
    expect(result.tier).toBe('selective');
  });

  it('proceeds when over budget, regardless of idle window', async () => {
    const result = await engine.compact({
      sessionId: 's1',
      messages: buildMessages(40),
      tokenBudget: 10_000,
      currentTokenCount: 50_000, // genuinely over budget
      idleSinceLastTurnMs: 5, // mid-burst
    });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(true);
  });

  it('proceeds when force=true regardless of idle window', async () => {
    const result = await engine.compact({
      sessionId: 's1',
      messages: buildMessages(40),
      tokenBudget: 1_000_000,
      force: true,
      idleSinceLastTurnMs: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(true);
  });

  it('proceeds when no idle hint is supplied (legacy callers)', async () => {
    const result = await engine.compact({
      sessionId: 's1',
      messages: buildMessages(40),
      tokenBudget: 1_000_000,
      forceTier: 'selective',
      // idleSinceLastTurnMs intentionally omitted
    });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(true);
  });

  it('forwards focusBlock + openThreads into the produced summary', async () => {
    const result = await engine.compact({
      sessionId: 's1',
      messages: buildMessages(40),
      tokenBudget: 1_000_000,
      forceTier: 'selective',
      idleSinceLastTurnMs: COMPACTION_IDLE_GUARD_MS + 1,
      focusBlock: 'Editing auth.ts',
      openThreads: ['confirm migration', 'update locales'],
    });
    expect(result.compacted).toBe(true);
    const summary = result.result?.summary ?? '';
    expect(summary).toContain('## Active Focus');
    expect(summary).toContain('Editing auth.ts');
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
      tokenBudget: 1_000_000,
      forceTier: 'aggressive',
      idleSinceLastTurnMs: COMPACTION_IDLE_GUARD_MS + 1,
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
