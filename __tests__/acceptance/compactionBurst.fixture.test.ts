import {
  COMPACTION_IDLE_GUARD_MS,
  DefaultContextEngine,
} from '../../src/services/context/compaction';
import type { Message } from '../../src/types/message';

jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
}));

const makeMsg = (role: 'user' | 'assistant' | 'tool', content: string): Message => ({
  id: `msg-${Math.random()}`,
  role,
  content,
  timestamp: Date.now(),
});

describe('compaction burst fixture', () => {
  const engine = new DefaultContextEngine();

  it('defers selective compaction during an active tool burst', async () => {
    const burstMessages = Array.from({ length: 24 }, (_, index) =>
      index % 2 === 0
        ? makeMsg('assistant', `step-${index}`)
        : makeMsg('tool', `result-${index} ${'payload '.repeat(40)}`),
    );

    const midBurst = await engine.compact({
      sessionId: 'burst',
      messages: burstMessages,
      tokenBudget: 10_000,
      currentTokenCount: 8_200,
      idleSinceLastTurnMs: 12_000,
    });

    expect(midBurst.compacted).toBe(false);
    expect(midBurst.reason).toContain('mid-burst');
  });

  it('allows selective compaction shortly after burst completion', async () => {
    const burstMessages = Array.from({ length: 30 }, (_, index) =>
      makeMsg(index % 2 === 0 ? 'user' : 'assistant', `turn-${index} ${'word '.repeat(24)}`),
    );

    const postBurst = await engine.compact({
      sessionId: 'burst',
      messages: burstMessages,
      tokenBudget: 10_000,
      currentTokenCount: 8_200,
      idleSinceLastTurnMs: COMPACTION_IDLE_GUARD_MS + 500,
      forceTier: 'selective',
    });

    expect(postBurst.compacted).toBe(true);
    expect(postBurst.tier).toBe('selective');
  });
});
