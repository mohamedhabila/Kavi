// ---------------------------------------------------------------------------
// Tests — Memory consolidator scheduler
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
import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import {
  countNewTurns,
  evaluateTrigger,
  flushAllDirtyThreads,
  getConsolidationState,
  listDirtyThreadIds,
  markThreadDirtyForMemory,
  maybeRunConsolidation,
  DEFAULT_TURN_THRESHOLD,
  DEFAULT_IDLE_THRESHOLD_MS,
} from '../../../src/services/memory/consolidatorScheduler';
import type { Message } from '../../../src/types/message';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    memoryConsolidationMode: 'off',
    consolidationProvider: null,
    providers: [],
  } as never);
});

afterEach(() => {
  closeMemoryDb();
});

const THREAD = 'thread-A';

function userMsg(id: string, ts: number, content = `u-${id}`): Message {
  return { id, role: 'user', content, timestamp: ts } as Message;
}

function asstMsg(id: string, ts: number, content = `a-${id}`): Message {
  return { id, role: 'assistant', content, timestamp: ts } as Message;
}

function buildTranscript(turns: number, anchorTs = 1_000): Message[] {
  // Each turn = user + assistant.
  const messages: Message[] = [];
  for (let i = 0; i < turns; i += 1) {
    messages.push(userMsg(`u${i}`, anchorTs + i * 1_000));
    messages.push(asstMsg(`a${i}`, anchorTs + i * 1_000 + 500));
  }
  return messages;
}

/** Keep `now` near the transcript so idle_threshold does not fire accidentally. */
function nearLastTurnNow(messages: Message[], offsetMs = 5): number {
  const last = messages[messages.length - 1];
  const ts = typeof last?.timestamp === 'number' ? last.timestamp : Date.now();
  return ts + offsetMs;
}

function seedDirtyThread(threadId: string, turns: number): Message[] {
  const messages = buildTranscript(turns);
  markThreadDirtyForMemory({ threadId, messages, now: nearLastTurnNow(messages) });
  return messages;
}

const STUB_EXTRACTOR = async () =>
  JSON.stringify({
    new_facts: [],
    active_focus: 'still working on it',
    open_threads: [],
    notable: [],
  });

describe('countNewTurns', () => {
  it('returns total user/assistant count when no anchor is set', () => {
    expect(countNewTurns({ messages: buildTranscript(3), lastConsolidatedMessageId: null })).toBe(
      6,
    );
  });

  it('counts only turns strictly after the anchor', () => {
    const messages = buildTranscript(5);
    // anchor at the 2nd assistant turn (index 3 — id=a1)
    expect(countNewTurns({ messages, lastConsolidatedMessageId: 'a1' })).toBe(6); // u2,a2,u3,a3,u4,a4
  });

  it('returns 0 when anchor is the final message', () => {
    const messages = buildTranscript(3);
    expect(
      countNewTurns({
        messages,
        lastConsolidatedMessageId: messages[messages.length - 1].id,
      }),
    ).toBe(0);
  });

  it('returns total when the anchor id is not found in the transcript', () => {
    const messages = buildTranscript(2);
    expect(countNewTurns({ messages, lastConsolidatedMessageId: 'missing' })).toBe(4);
  });
});

describe('evaluateTrigger', () => {
  it('does not trigger when there is no closed assistant turn', () => {
    const messages: Message[] = [userMsg('u0', 1)];
    const result = evaluateTrigger({ threadId: THREAD, messages, now: 100_000 });
    expect(result.shouldRun).toBe(false);
    expect(result.newTurns).toBe(0);
  });

  it('does not trigger when no new turns since last anchor', () => {
    const messages = buildTranscript(2);
    const result = evaluateTrigger({
      threadId: THREAD,
      messages,
      now: 100_000,
      state: {
        threadId: THREAD,
        lastConsolidatedMessageId: messages[messages.length - 1].id,
        lastConsolidatedAt: 50_000,
        turnsSinceLast: 0,
        updatedAt: 50_000,
      },
    });
    expect(result.shouldRun).toBe(false);
    expect(result.newTurns).toBe(0);
  });

  it('fires turn_threshold once 8 user/assistant messages accumulate', () => {
    const messages = buildTranscript(4); // 8 turns
    const result = evaluateTrigger({
      threadId: THREAD,
      messages,
      now: messages[messages.length - 1].timestamp! + 5,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('turn_threshold');
    expect(result.newTurns).toBe(8);
    expect(result.anchorMessageId).toBe('a3');
  });

  it('fires idle_threshold once ≥10min has passed since the last assistant turn', () => {
    const messages = buildTranscript(1); // only 2 turns — below turn threshold
    const lastTs = messages[messages.length - 1].timestamp!;
    const result = evaluateTrigger({
      threadId: THREAD,
      messages,
      now: lastTs + DEFAULT_IDLE_THRESHOLD_MS + 1,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('idle_threshold');
    expect(result.newTurns).toBe(2);
  });

  it('does not fire idle when below threshold', () => {
    const messages = buildTranscript(1);
    const lastTs = messages[messages.length - 1].timestamp!;
    const result = evaluateTrigger({
      threadId: THREAD,
      messages,
      now: lastTs + DEFAULT_IDLE_THRESHOLD_MS - 1,
    });
    expect(result.shouldRun).toBe(false);
  });

  it('app_background takes precedence over both other reasons', () => {
    const messages = buildTranscript(1); // not enough turns and not idle
    const lastTs = messages[messages.length - 1].timestamp!;
    const result = evaluateTrigger({
      threadId: THREAD,
      messages,
      now: lastTs + 5,
      appBackgrounded: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('app_background');
  });

  it('respects custom turnThreshold + idleThresholdMs overrides', () => {
    const messages = buildTranscript(2); // 4 turns
    const lastTs = messages[messages.length - 1].timestamp!;
    const result = evaluateTrigger({
      threadId: THREAD,
      messages,
      now: lastTs + 1,
      turnThreshold: 4,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('turn_threshold');
  });
});

describe('maybeRunConsolidation gating', () => {
  it('marks a single completed chitchat turn dirty without a provider', () => {
    const messages = [
      userMsg('u-live', 1, 'Remember that I like concise plans.'),
      {
        ...asstMsg('a-live', 2, 'Got it.'),
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
      },
    ] as Message[];

    const result = markThreadDirtyForMemory({ threadId: THREAD, messages, now: 3 });

    expect(result.marked).toBe(true);
    expect(result.newTurns).toBe(2);
    expect(getConsolidationState(THREAD)?.turnsSinceLast).toBe(2);
  });

  it('does not mark incomplete assistant turns dirty', () => {
    const messages = [
      userMsg('u-stop', 1, 'Start this but I will stop it.'),
      {
        ...asstMsg('a-stop', 2, 'Partial draft'),
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        },
      },
    ] as Message[];

    const result = markThreadDirtyForMemory({ threadId: THREAD, messages, now: 3 });

    expect(result.marked).toBe(false);
    expect(result.skipped).toBe('no_closed_turn');
    expect(getConsolidationState(THREAD)).toBeNull();
  });

  it('runs structural consolidation when no extractor is configured', async () => {
    const messages = buildTranscript(DEFAULT_TURN_THRESHOLD);
    const result = await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: null,
      now: 999_000,
    });
    expect(result.ran).toBe(true);
    expect(getConsolidationState(THREAD)?.lastConsolidatedMessageId).toBe(
      messages[messages.length - 1].id,
    );
  });

  it('still records dirty turn count even when no provider is set', async () => {
    const messages = buildTranscript(2);
    await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: null,
      now: nearLastTurnNow(messages),
    });
    expect(getConsolidationState(THREAD)?.turnsSinceLast).toBe(4);
    expect(listDirtyThreadIds()).toContain(THREAD);
  });

  it('falls back to structural consolidation when specific provider is missing', async () => {
    useSettingsStore.setState({
      memoryConsolidationMode: 'specific',
      consolidationProvider: 'openai',
      providers: [],
    } as never);
    const messages = buildTranscript(DEFAULT_TURN_THRESHOLD);
    const result = await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: 'openai',
      now: nearLastTurnNow(messages),
    });
    expect(result.ran).toBe(true);
    expect(getConsolidationState(THREAD)?.lastConsolidatedMessageId).toBe(
      messages[messages.length - 1].id,
    );
  });

  it('returns no_trigger when provider configured but conditions not met', async () => {
    const messages = buildTranscript(1);
    const extractor = jest.fn(STUB_EXTRACTOR);
    const result = await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: 'openai',
      extractor,
      now: messages[messages.length - 1].timestamp! + 5,
    });
    expect(result.ran).toBe(false);
    expect(result.skipped).toBe('no_trigger');
    expect(extractor).not.toHaveBeenCalled();
  });

  it('runs the consolidator and advances state on a turn_threshold fire', async () => {
    const messages = buildTranscript(DEFAULT_TURN_THRESHOLD);
    const extractor = jest.fn(STUB_EXTRACTOR);
    const result = await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: 'openai',
      extractor,
      now: 999_000,
    });
    expect(result.ran).toBe(true);
    expect(result.reason).toBe('turn_threshold');
    expect(extractor).toHaveBeenCalledTimes(1);
    const state = getConsolidationState(THREAD);
    expect(state?.lastConsolidatedMessageId).toBe(messages[messages.length - 1].id);
    expect(state?.turnsSinceLast).toBe(0);
    expect(state?.lastConsolidatedAt).toBe(999_000);
  });

  it('does not retry the same turn on the next call (cursor advances)', async () => {
    const messages = buildTranscript(DEFAULT_TURN_THRESHOLD);
    const extractor = jest.fn(STUB_EXTRACTOR);
    await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: 'openai',
      extractor,
    });
    extractor.mockClear();

    const second = await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: 'openai',
      extractor,
    });
    expect(second.ran).toBe(false);
    expect(second.skipped).toBe('no_trigger');
    expect(extractor).not.toHaveBeenCalled();
  });

  it('captures extractor throws as extractor_threw without persisting', async () => {
    const messages = buildTranscript(DEFAULT_TURN_THRESHOLD);
    // The base consolidateTurn already swallows extractor throws and returns
    // an empty result, so we drive the failure by making the extractor never
    // resolve. Simulate the extreme case via a synchronous throw inside the
    // scheduler's own try/catch by mocking consolidateTurn to throw.
    const consolidatorModule = require('../../../src/services/memory/consolidator');
    const spy = jest
      .spyOn(consolidatorModule, 'consolidateTurn')
      .mockRejectedValueOnce(new Error('synthetic'));
    try {
      const result = await maybeRunConsolidation({
        threadId: THREAD,
        messages,
        consolidationProvider: 'openai',
        extractor: STUB_EXTRACTOR,
      });
      expect(result.ran).toBe(false);
      expect(result.skipped).toBe('extractor_threw');
      // Cursor must NOT have advanced — we'll retry on the next call.
      expect(getConsolidationState(THREAD)?.lastConsolidatedMessageId).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('flushAllDirtyThreads', () => {
  it('flushes dirty threads using cascade or structural consolidation without provider id', async () => {
    const messages = seedDirtyThread(THREAD, DEFAULT_TURN_THRESHOLD / 2);
    const counters = await flushAllDirtyThreads({
      loadMessages: () => messages,
      consolidationProvider: null,
      now: nearLastTurnNow(messages),
    });
    expect(counters.attempted).toBe(1);
    expect(counters.ran).toBe(1);
    expect(listDirtyThreadIds()).toEqual([]);
  });

  it('flushes every dirty thread on app-background', async () => {
    const dirtyThreads: Record<string, Message[]> = {
      a: seedDirtyThread('a', 2),
      b: seedDirtyThread('b', 3),
    };
    expect(listDirtyThreadIds().sort()).toEqual(['a', 'b']);

    const extractor = jest.fn(STUB_EXTRACTOR);
    const counters = await flushAllDirtyThreads({
      loadMessages: (threadId) => dirtyThreads[threadId] ?? [],
      consolidationProvider: 'openai',
      extractor,
      now: nearLastTurnNow(dirtyThreads.b),
    });
    expect(counters.attempted).toBe(2);
    expect(counters.ran).toBe(2);
    expect(counters.errors).toBe(0);
    expect(extractor).toHaveBeenCalledTimes(2);
    expect(listDirtyThreadIds()).toEqual([]);
  });

  it('records errors but keeps going across threads', async () => {
    const dirtyThreads: Record<string, Message[]> = {
      a: seedDirtyThread('a', 2),
      b: seedDirtyThread('b', 2),
    };

    const counters = await flushAllDirtyThreads({
      loadMessages: (threadId) => {
        if (threadId === 'a') throw new Error('boom');
        return dirtyThreads[threadId] ?? [];
      },
      consolidationProvider: 'openai',
      extractor: STUB_EXTRACTOR,
      now: nearLastTurnNow(dirtyThreads.b),
    });
    expect(counters.attempted).toBe(2);
    expect(counters.errors).toBe(1);
    expect(counters.ran).toBe(1);
  });

  it('skips threads whose loadMessages returns empty', async () => {
    seedDirtyThread('a', 2);
    const counters = await flushAllDirtyThreads({
      loadMessages: () => [],
      consolidationProvider: 'openai',
      extractor: STUB_EXTRACTOR,
    });
    expect(counters.attempted).toBe(1);
    expect(counters.skipped).toBe(1);
    expect(counters.ran).toBe(0);
  });

  it('returns zero counters when disableLongTermMemory is true', async () => {
    seedDirtyThread('a', 2);
    const extractor = jest.fn(STUB_EXTRACTOR);
    const counters = await flushAllDirtyThreads({
      loadMessages: () => buildTranscript(2),
      consolidationProvider: 'openai',
      extractor,
      disableLongTermMemory: true,
    });
    expect(counters).toEqual({ attempted: 0, ran: 0, skipped: 0, errors: 0 });
    expect(extractor).not.toHaveBeenCalled();
  });
});

describe('maybeRunConsolidation opt-out', () => {
  it('returns skipped=opt_out without invoking extractor or upserting state', async () => {
    const messages = buildTranscript(DEFAULT_TURN_THRESHOLD);
    const extractor = jest.fn(STUB_EXTRACTOR);
    const result = await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: 'openai',
      extractor,
      disableLongTermMemory: true,
    });
    expect(result.ran).toBe(false);
    expect(result.skipped).toBe('opt_out');
    expect(extractor).not.toHaveBeenCalled();
    expect(getConsolidationState(THREAD)).toBeNull();
  });
});
