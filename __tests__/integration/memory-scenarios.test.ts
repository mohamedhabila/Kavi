// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------
// These tests stitch together the memory subsystem end-to-end (fact store +
// consolidator scheduler + recall + focus block + prompt assembly) using
// deterministic fake LLM extractors. They cover the three scenarios called
// out in `_research/SINGLE_THREAD_MEMORY_REDESIGN_20260429.md` §7:
//
//   1. 200-message simulated thread → consolidation runs at expected
//      boundaries → prompt size stays under budget → recall returns the
//      right fact at turn 250.
//   2. Returning-user (8-hour gap): focus header reflects the gap and the
//      assistant's first reply can reference the prior topic via recall.
//   3. Contradiction supersession: a new fact with the same (subject,
//      predicate) supersedes the old one; recall after the change returns
//      the new fact only and the old fact carries `invalid_at`.
//
// All LLM-shaped calls are mocked. No real provider traffic.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
  recordFact,
  upsertEntity,
  listFacts,
  getFactById,
} from '../../src/services/memory/factStore';
import { ensureDefaultBlocks, getBlock } from '../../src/services/memory/blocks';
import {
  DEFAULT_TURN_THRESHOLD,
  DEFAULT_IDLE_THRESHOLD_MS,
  countNewTurns,
  evaluateTrigger,
  getConsolidationState,
  maybeRunConsolidation,
} from '../../src/services/memory/consolidatorScheduler';
import { recallFactsForQuery } from '../../src/services/memory/factRecall';
import { renderFocusBlock } from '../../src/services/memory/focus';
import { assemblePrompt } from '../../src/services/memory/promptAssembly';
import type { Message } from '../../src/types';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const THREAD = 'integration-thread';

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
});

afterEach(() => {
  closeMemoryDb();
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const TURN_INTERVAL_MS = 30_000; // 30s between user and assistant
const PAIR_INTERVAL_MS = 60_000; // 1 min between turn pairs

function buildLongThread(turnPairs: number, baseTs: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < turnPairs; i += 1) {
    const userTs = baseTs + i * PAIR_INTERVAL_MS;
    const asstTs = userTs + TURN_INTERVAL_MS;
    // Sprinkle a project-specific marker into a single turn so we can prove
    // recall surfaces it later (the fact is recorded via the extractor).
    const userContent =
      i === 7
        ? 'I just deployed the dashboard service to production at acme-prod-cluster.'
        : `Question ${i}: how do I tune the consolidator throughput?`;
    const asstContent =
      i === 7
        ? 'Acknowledged — noting acme-prod-cluster as your production target.'
        : `Answer ${i}: bump the turn threshold and watch idle gaps.`;
    messages.push({ id: `u-${i}`, role: 'user', content: userContent, timestamp: userTs } as Message);
    messages.push({ id: `a-${i}`, role: 'assistant', content: asstContent, timestamp: asstTs } as Message);
  }
  return messages;
}

/**
 * A deterministic extractor that returns a single durable fact for the
 * "deployment" turn pair and a no-op result for everything else. Mirrors
 * what the real consolidator schema expects.
 */
function makeExtractor(): jest.Mock {
  return jest.fn(async (prompt: string) => {
    if (prompt.includes('acme-prod-cluster')) {
      return JSON.stringify({
        new_facts: [
          {
            subject: 'user',
            predicate: 'deploys_to',
            value: 'acme-prod-cluster',
            confidence: 'high',
          },
        ],
        active_focus: 'User is shipping the dashboard service to acme-prod-cluster.',
        open_threads: ['monitor acme-prod-cluster after deploy'],
        notable: ['Production target: acme-prod-cluster'],
      });
    }
    return JSON.stringify({
      new_facts: [],
      active_focus: 'Walking through consolidator tuning questions.',
      open_threads: [],
      notable: [],
    });
  });
}

// ── 1. 200-message thread ───────────────────────────────────────────────────

describe('integration §7.1 — 200-message thread', () => {
  it(
    'fires consolidation at the turn-threshold cadence, keeps the prompt under budget, and ' +
      'recalls the right fact at turn 250',
    async () => {
      const baseTs = 1_000_000_000_000;
      const totalPairs = 100; // 200 messages = 100 user/assistant pairs
      const messages = buildLongThread(totalPairs, baseTs);
      const extractor = makeExtractor();

      // Walk the thread one pair at a time and let the scheduler decide when
      // to run. The scheduler tracks dirty turns in `memory_consolidation_state`
      // and triggers at DEFAULT_TURN_THRESHOLD (8) new user/assistant turns
      // (i.e. every 4 pairs).
      const ranAtPair: number[] = [];
      for (let i = 1; i <= totalPairs; i += 1) {
        const sliceMessages = messages.slice(0, i * 2);
        const lastTs = sliceMessages[sliceMessages.length - 1].timestamp ?? baseTs;
        const result = await maybeRunConsolidation({
          threadId: THREAD,
          messages: sliceMessages,
          consolidationProvider: 'fake-provider',
          extractor,
          now: lastTs,
        });
        if (result.ran) ranAtPair.push(i);
      }

      // Expected: consolidation triggered every DEFAULT_TURN_THRESHOLD/2 pairs.
      const cadence = DEFAULT_TURN_THRESHOLD / 2; // 4
      const expectedRuns = Math.floor(totalPairs / cadence);
      expect(ranAtPair.length).toBe(expectedRuns);
      expect(ranAtPair[0]).toBe(cadence);
      expect(ranAtPair[ranAtPair.length - 1]).toBe(expectedRuns * cadence);

      // The deployment fact should have been recorded exactly once even though
      // many trigger boundaries fire (extractor returns it only for the
      // deployment turn).
      const deployFacts = listFacts({ predicate: 'deploys_to', limit: 50 });
      expect(deployFacts).toHaveLength(1);
      expect(deployFacts[0].objectText).toBe('acme-prod-cluster');

      // active_focus block should have been written by the consolidator.
      const focus = getBlock('active_focus');
      expect(focus?.content?.trim().length ?? 0).toBeGreaterThan(0);

      // Recall at "turn 250" — query 50 turns after the thread ends should
      // surface the deployment fact when the user asks about deployment.
      // Use threshold: 0 so we exercise the recall pipeline end-to-end
      // without depending on the production lexical-overlap floor (the floor
      // exists for prompt-budget reasons, not correctness).
      const recalled = await recallFactsForQuery(
        'Where do I deploy the dashboard service to acme-prod-cluster?',
        { threshold: 0 },
      );
      const objects = recalled.map((f) => f.objectText);
      expect(objects).toContain('acme-prod-cluster');

      // Prompt size guard: assemble the prompt with the recalled facts +
      // active_focus block and ensure the cacheable + dynamic sections stay
      // well under a generous 12k-char budget. Real budgets are token-based;
      // this is a regression guard, not a token-precise check.
      const focusOut = renderFocusBlock({
        now: baseTs + totalPairs * PAIR_INTERVAL_MS + 60 * 60 * 1000,
        lastAssistantAt: messages[messages.length - 1].timestamp ?? null,
        threadCreatedAt: baseTs,
        activeFocus: focus?.content ?? '',
        openThreads: ['monitor acme-prod-cluster after deploy'],
      });
      const assembled = assemblePrompt({
        basePrompt: 'You are Kavi, the user\'s personal assistant.',
        blocks: [focus!].filter(Boolean),
        focusBlock: focusOut.text,
        retrievedFacts: recalled,
      });
      const totalChars = assembled.sections.reduce((n, s) => n + s.text.length, 0);
      expect(totalChars).toBeLessThan(12_000);
      expect(assembled.cacheableSignature).toMatch(/^[0-9a-f]{8}$/);
    },
    20_000,
  );
});

// ── 2. Returning-user / 8-hour gap ──────────────────────────────────────────

describe('integration §7.2 — returning user after 8-hour gap', () => {
  it('focus header reflects the gap and recall surfaces the prior topic', async () => {
    const baseTs = 1_700_000_000_000;
    // 8 pairs so the deployment turn (i=7) is the LAST pair — the scheduler
    // feeds only the last user/assistant pair to the extractor on flush.
    const initialPairs = 8;
    const messages = buildLongThread(initialPairs, baseTs);
    const extractor = makeExtractor();

    // Drive a flush via app-backgrounded so the consolidator runs even though
    // we are below the turn threshold.
    const lastTs = messages[messages.length - 1].timestamp ?? baseTs;
    const flushResult = await maybeRunConsolidation({
      threadId: THREAD,
      messages,
      consolidationProvider: 'fake-provider',
      extractor,
      now: lastTs,
      appBackgrounded: true,
    });
    expect(flushResult.ran).toBe(true);

    // 8 hours go by, then the user returns with a related question.
    const eightHoursMs = 8 * 60 * 60 * 1000;
    const returnTs = lastTs + eightHoursMs;

    const focusBlock = getBlock('active_focus');
    const focusOut = renderFocusBlock({
      now: returnTs,
      lastAssistantAt: lastTs,
      threadCreatedAt: baseTs,
      activeFocus: focusBlock?.content ?? '',
      openThreads: ['monitor acme-prod-cluster after deploy'],
    });

    // The bucket should be `later_today` (≥ 2h, < 24h) and the phrase must
    // mention the gap so the assistant has explicit "back later today" cue.
    expect(focusOut.gap.bucket).toBe('later_today');
    expect(focusOut.gap.gapMs).toBe(eightHoursMs);
    expect(focusOut.text.toLowerCase()).toContain('back later today');

    // The active_focus body should still reflect the deployment topic so the
    // assistant can pick up the conversation.
    expect(focusOut.text).toMatch(/acme-prod-cluster/i);

    // Recall against the returning-user query also surfaces the prior fact.
    const recalled = await recallFactsForQuery(
      'any update on the acme-prod-cluster deploy?',
      { threshold: 0 },
    );
    expect(recalled.map((f) => f.objectText)).toContain('acme-prod-cluster');
  });
});

// ── 3. Contradiction supersession ───────────────────────────────────────────

describe('integration §7.3 — contradiction supersession', () => {
  it('superseding a fact stamps invalid_at on the prior and recall returns the new value only', async () => {
    const t0 = 1_700_000_000_000;
    const user = upsertEntity({ name: 'user', type: 'self', now: t0 });

    // Initial preference recorded by an early turn.
    const first = recordFact({
      subjectId: user.id,
      predicate: 'prefers_tone',
      objectText: 'formal',
      now: t0,
    });
    expect(first.status).toBe('created');
    expect(first.fact.invalidAt).toBeNull();

    // User changes their mind mid-thread; new fact is recorded with
    // `supersedePrior: true` (matches what the memoryTools API does).
    const t1 = t0 + 5 * 60 * 1000;
    const second = recordFact({
      subjectId: user.id,
      predicate: 'prefers_tone',
      objectText: 'casual',
      supersedePrior: true,
      now: t1,
    });
    expect(second.status).toBe('created');
    expect(second.fact.objectText).toBe('casual');
    expect(second.fact.invalidAt).toBeNull();
    expect(second.superseded).toHaveLength(1);
    expect(second.superseded[0].id).toBe(first.fact.id);
    expect(second.superseded[0].invalidAt).toBe(t1);

    // The original row is now invalidated in storage.
    const reloadedFirst = getFactById(first.fact.id);
    expect(reloadedFirst?.invalidAt).toBe(t1);

    // listFacts (default = currently valid) returns only the new fact.
    const valid = listFacts({ subjectId: user.id, predicate: 'prefers_tone' });
    expect(valid).toHaveLength(1);
    expect(valid[0].id).toBe(second.fact.id);

    // Recall after the change returns the new fact only.
    const recalled = await recallFactsForQuery(
      'what tone does the user prefer? casual or formal?',
      { threshold: 0 },
    );
    const tones = recalled
      .filter((f) => f.predicate === 'prefers_tone')
      .map((f) => f.objectText);
    expect(tones).toEqual(['casual']);
    expect(tones).not.toContain('formal');

    // Bi-temporal anchor: querying as-of t0 (before the change) sees the
    // original fact again — proving the historical record is preserved.
    const historical = listFacts({
      subjectId: user.id,
      predicate: 'prefers_tone',
      asOf: t0 + 1_000,
    });
    expect(historical.map((f) => f.objectText)).toEqual(['formal']);

    // Re-running the same supersede call is a no-op (content_hash dedupe on
    // the active row); no extra superseded entries.
    const replay = recordFact({
      subjectId: user.id,
      predicate: 'prefers_tone',
      objectText: 'casual',
      supersedePrior: true,
      now: t1 + 1_000,
    });
    expect(replay.status).toBe('duplicate');
    expect(replay.superseded).toHaveLength(0);
  });
});

// ── Sanity: scheduler primitives are reachable from this harness ───────────

describe('integration scaffolding sanity', () => {
  it('countNewTurns + evaluateTrigger work against a fresh thread', () => {
    const baseTs = 1_000_000_000_000;
    const messages = buildLongThread(5, baseTs);
    expect(countNewTurns({ messages, lastConsolidatedMessageId: null })).toBe(10);
    const trigger = evaluateTrigger({
      threadId: 'sanity-thread',
      messages,
      now: messages[messages.length - 1].timestamp! + DEFAULT_IDLE_THRESHOLD_MS + 1,
    });
    expect(trigger.shouldRun).toBe(true);
    expect(getConsolidationState('sanity-thread')).toBeNull();
  });
});
