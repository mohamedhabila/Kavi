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
import { setManagedMemoryFactPinned } from '../../../src/services/memory/factExplicitOverrides';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import type {
  MemoryFactKind,
  MemoryFactScope,
  RecordFactInput,
} from '../../../src/services/memory/facts/types';
import { getFactById } from '../../../src/services/memory/facts/queries';
import {
  recallFactsForQuery as recallFactsForQueryImpl,
  recallScoredFactsForQuery as recallScoredFactsForQueryImpl,
} from '../../../src/services/memory/factRecall';
import type { RecallFactsOptions } from '../../../src/services/memory/factRecallTypes';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const WORKFLOW_KINDS = new Set<MemoryFactKind>([
  'agent_run',
  'artifact',
  'decision',
  'evidence_span',
  'goal',
  'gotcha',
  'risk',
  'source',
  'summary',
  'tool_result',
]);

type TestRecordFactInput = Omit<RecordFactInput, 'scope'> & { scope?: MemoryFactScope };
type TestRecallOptions = Omit<RecallFactsOptions, 'memoryScope' | 'useIntent'> & {
  conversationId?: string;
  threadId?: string;
  taskId?: string;
};

function recordFact(input: TestRecordFactInput) {
  const scope = input.scope ?? 'global';
  const memoryKind = input.memoryKind ?? 'semantic_fact';
  return recordFactWithApplicability(
    { ...input, scope },
    WORKFLOW_KINDS.has(memoryKind)
      ? { factClass: 'workflow', sourceAuthority: 'tool_observed' }
      : { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
}

function withRecallAccess(options: TestRecallOptions = {}): RecallFactsOptions {
  const { conversationId = 'fact-recall-root', threadId, taskId, ...recallOptions } = options;
  return {
    ...recallOptions,
    memoryScope: resolveLocalMemoryAccessScope({
      memoryConversationId: conversationId,
      sourceThreadId: threadId ?? conversationId,
      personaId: 'default',
      taskId: taskId ?? null,
    }),
    useIntent: 'automatic_prompt',
  };
}

function recallFactsForQuery(query: string, options: TestRecallOptions = {}) {
  return recallFactsForQueryImpl(query, withRecallAccess(options));
}

function recallScoredFactsForQuery(query: string, options: TestRecallOptions = {}) {
  return recallScoredFactsForQueryImpl(query, withRecallAccess(options));
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('recallFactsForQuery — text-only (no embedding config)', () => {
  it('returns matching facts when query tokens overlap subject/predicate/value', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin' });
    recordFact({ subjectId: user.id, predicate: 'works_at', objectText: 'Acme' });

    const facts = await recallFactsForQuery('Where does the user live in Berlin?');

    expect(facts.map((f) => f.objectText)).toContain('Berlin');
    // Acme has no token overlap with the query, so it should not appear.
    expect(facts.map((f) => f.objectText)).not.toContain('Acme');
  });

  it('returns empty array when nothing matches and no pinned facts exist', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin' });

    const facts = await recallFactsForQuery('totally unrelated query xyzzy');

    expect(facts).toHaveLength(0);
  });

  it('respects the limit option', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    for (let i = 0; i < 5; i++) {
      recordFact({
        subjectId: user.id,
        predicate: `pref_${i}`,
        objectText: `coffee variant ${i}`,
      });
    }

    const facts = await recallFactsForQuery('coffee', { limit: 2 });

    expect(facts).toHaveLength(2);
  });

  it('recalls Arabic text without ASCII-only tokenization', async () => {
    const user = upsertEntity({ name: 'المستخدم', type: 'self' });
    recordFact({
      subjectId: user.id,
      predicate: 'مشروب',
      objectText: 'القهوة السادة',
    });

    const facts = await recallFactsForQuery('أحتاج القهوة السادة');

    expect(facts.map((f) => f.objectText)).toContain('القهوة السادة');
  });

  it('recalls segmented CJK text without whitespace delimiters', async () => {
    const trip = upsertEntity({ name: '旅行', type: 'concept' });
    recordFact({
      subjectId: trip.id,
      predicate: '会議場所',
      objectText: '東京',
    });

    const facts = await recallFactsForQuery('東京の会議場所');

    expect(facts.map((f) => f.objectText)).toContain('東京');
  });
});

describe('recallFactsForQuery — pinned facts', () => {
  it('always includes pinned facts even when they would not otherwise match', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const pinnedResult = recordFact({
      subjectId: user.id,
      predicate: 'preferred_pronouns',
      objectText: 'they/them',
    });
    setManagedMemoryFactPinned({ factId: pinnedResult.fact.id, pinned: true });

    const facts = await recallFactsForQuery('what is the weather today');

    expect(facts.map((f) => f.id)).toContain(pinnedResult.fact.id);
  });

  it('returns only pinned facts when query is empty', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const pinned = recordFact({
      subjectId: user.id,
      predicate: 'name',
      objectText: 'Alice',
    });
    setManagedMemoryFactPinned({ factId: pinned.fact.id, pinned: true });
    recordFact({ subjectId: user.id, predicate: 'lives_in', objectText: 'Berlin' });

    const facts = await recallFactsForQuery('   ');

    expect(facts).toHaveLength(1);
    expect(facts[0].id).toBe(pinned.fact.id);
  });

  it('returns empty when alwaysIncludePinned is false and query is empty', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const pinned = recordFact({
      subjectId: user.id,
      predicate: 'name',
      objectText: 'Alice',
    });
    setManagedMemoryFactPinned({ factId: pinned.fact.id, pinned: true });

    const facts = await recallFactsForQuery('', { alwaysIncludePinned: false });

    expect(facts).toHaveLength(0);
  });
});

describe('recallFactsForQuery — bi-temporal anchor', () => {
  it('honors the asOf option to recall facts that were valid at a past time', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const t0 = 1_000;
    const t1 = 2_000;
    const t2 = 3_000;

    recordFact({
      subjectId: user.id,
      predicate: 'works_at',
      objectText: 'Acme',
      now: t0,
    });
    // Supersedes Acme at t1.
    recordFact({
      subjectId: user.id,
      predicate: 'works_at',
      objectText: 'Globex',
      supersedePrior: true,
      now: t1,
    });

    const past = await recallFactsForQuery('works at', { asOf: t0 + 500 });
    const recent = await recallFactsForQuery('works at', { asOf: t2 });

    expect(past.map((f) => f.objectText)).toContain('Acme');
    expect(past.map((f) => f.objectText)).not.toContain('Globex');
    expect(recent.map((f) => f.objectText)).toContain('Globex');
    expect(recent.map((f) => f.objectText)).not.toContain('Acme');
  });
});

describe('recallScoredFactsForQuery', () => {
  it('returns scoring breakdown alongside selected facts', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const fact = recordFact({
      subjectId: user.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
    });
    setManagedMemoryFactPinned({ factId: fact.fact.id, pinned: true });

    const scored = await recallScoredFactsForQuery('user lives Berlin');

    expect(scored).toHaveLength(1);
    expect(scored[0].fact.id).toBe(fact.fact.id);
    expect(scored[0].pinnedBoost).toBeGreaterThan(0);
    expect(scored[0].textScore).toBeGreaterThan(0);
    // Combined score includes weighted text, confidence/decay, pinned,
    // importance, and reinforcement components.
    expect(scored[0].score).toBeGreaterThan(scored[0].pinnedBoost);
    expect(scored[0].importanceScore).toBeGreaterThan(0);
    expect(scored[0].decayMultiplier).toBeGreaterThan(0);
  });

  it('uses a semantic selector as the authoritative evidence selection', async () => {
    const project = upsertEntity({ name: 'alpha release', type: 'project' });
    const first = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'alpha release backend uses remote execution by default',
      importance: 0.9,
    });
    const selected = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'alpha release backend uses local execution after verified migration evidence',
      importance: 0.1,
      supersedePrior: false,
    });
    let observedCandidateIds: string[] = [];

    const scored = await recallScoredFactsForQuery('alpha release backend execution', {
      limit: 2,
      selector: async ({ candidates }) => {
        observedCandidateIds = candidates.map((candidate) => candidate.fact.id);
        return { factIds: [selected.fact.id] };
      },
    });

    expect(observedCandidateIds).toEqual(expect.arrayContaining([first.fact.id, selected.fact.id]));
    expect(scored.map((entry) => entry.fact.id)).toEqual([selected.fact.id]);
  });

  it('shows high-information query evidence to the semantic selector beyond the top prefix', async () => {
    const project = upsertEntity({ name: 'delta release', type: 'project' });
    const target = recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: 'zqxj-confirmed evidence appears in the final tool observation',
      importance: 0.1,
      retrievability: 0.1,
    });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: project.id,
        predicate: 'observation',
        objectText: `delta release project planning evidence ${index}`,
        importance: 0.9,
        supersedePrior: false,
      });
    }
    let observedCandidateIds: string[] = [];

    const scored = await recallScoredFactsForQuery('delta release project zqxj-confirmed', {
      limit: 1,
      selectorCandidateLimit: 4,
      selector: async ({ candidates }) => {
        observedCandidateIds = candidates.map((candidate) => candidate.fact.id);
        return { factIds: [target.fact.id] };
      },
    });

    expect(observedCandidateIds).toContain(target.fact.id);
    expect(scored.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
  });

  it('keeps pinned evidence protected when semantic selection is available', async () => {
    const project = upsertEntity({ name: 'gamma release', type: 'project' });
    const pinned = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'gamma release must always include verified compliance notes',
      importance: 0.9,
    });
    setManagedMemoryFactPinned({ factId: pinned.fact.id, pinned: true });
    const selected = recordFact({
      subjectId: project.id,
      predicate: 'risk',
      objectText: 'gamma release has an unresolved migration risk',
      importance: 0.1,
      supersedePrior: false,
    });

    const scored = await recallScoredFactsForQuery('gamma release backend execution', {
      limit: 2,
      threshold: 0.2,
      selector: async () => ({ factIds: [selected.fact.id] }),
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([pinned.fact.id, selected.fact.id]);
  });

  it('falls back to the local ranking when the semantic selector returns no usable ids', async () => {
    const project = upsertEntity({ name: 'beta release', type: 'project' });
    const expected = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'beta release backend uses local execution',
      importance: 0.9,
    });
    recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'beta release backend uses remote execution',
      importance: 0.1,
      supersedePrior: false,
    });

    const scored = await recallScoredFactsForQuery('beta release backend local execution', {
      limit: 1,
      selector: async () => ({ factIds: ['not-a-candidate'] }),
    });

    expect(scored).toHaveLength(1);
    expect(scored[0].fact.id).toBe(expected.fact.id);
  });
});

describe('recallFactsForQuery — scoped decay and reinforcement', () => {
  it('boosts facts from the active conversation over similarly matching global facts', async () => {
    const user = upsertEntity({ name: 'project alpha', type: 'project' });
    const scoped = recordFact({
      subjectId: user.id,
      predicate: 'decision',
      objectText: 'Use the LiteRT backend for alpha',
      scope: 'conversation',
      originConversationId: 'conv-alpha',
      importance: 0.7,
      now: 10_000,
    });
    const global = recordFact({
      subjectId: user.id,
      predicate: 'decision',
      objectText: 'Use the remote backend for alpha',
      scope: 'global',
      importance: 0.7,
      supersedePrior: false,
      now: 10_000,
    });

    const facts = await recallFactsForQuery('alpha backend decision', {
      conversationId: 'conv-alpha',
      now: 20_000,
      limit: 2,
    });

    expect(facts[0].id).toBe(scoped.fact.id);
    expect(facts.map((fact) => fact.id)).toContain(global.fact.id);
  });

  it('excludes facts from other conversations before scoring, even when pinned', async () => {
    const project = upsertEntity({ name: 'project beta', type: 'project' });
    const active = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'Use the local LiteRT backend for beta',
      scope: 'conversation',
      originConversationId: 'conv-active',
      importance: 0.4,
      now: 10_000,
    });
    const other = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'Use the remote cloud backend for beta',
      scope: 'conversation',
      originConversationId: 'conv-other',
      importance: 1,
      now: 20_000,
    });
    setManagedMemoryFactPinned({ factId: other.fact.id, pinned: true });

    const facts = await recallFactsForQuery('beta backend decision', {
      conversationId: 'conv-active',
      now: 30_000,
      limit: 5,
    });

    expect(facts.map((fact) => fact.id)).toContain(active.fact.id);
    expect(facts.map((fact) => fact.id)).not.toContain(other.fact.id);
  });

  it('excludes session facts from other tasks before scoring', async () => {
    const task = upsertEntity({ name: 'release task', type: 'task' });
    const active = recordFact({
      subjectId: task.id,
      predicate: 'next_step',
      objectText: 'Run the Android release validation',
      scope: 'session',
      originConversationId: 'conv-release',
      originThreadId: 'conv-release',
      originTaskId: 'task-active',
      importance: 0.5,
    });
    const other = recordFact({
      subjectId: task.id,
      predicate: 'next_step',
      objectText: 'Skip validation and deploy directly',
      scope: 'session',
      originConversationId: 'conv-release',
      originThreadId: 'conv-release',
      originTaskId: 'task-other',
      importance: 1,
    });
    setManagedMemoryFactPinned({ factId: other.fact.id, pinned: true });

    const facts = await recallFactsForQuery('release validation next step', {
      conversationId: 'conv-release',
      taskId: 'task-active',
      limit: 5,
    });

    expect(facts.map((fact) => fact.id)).toContain(active.fact.id);
    expect(facts.map((fact) => fact.id)).not.toContain(other.fact.id);
  });

  it('does not retrieve current-conversation facts on recency alone', async () => {
    const user = upsertEntity({ name: 'beam-user', type: 'person' });
    const conversationId = 'conv-current-state';

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
      predicate: 'reminder_window',
      objectText: 'BEAM-WINDOW-9',
      scope: 'conversation',
      originConversationId: conversationId,
      now: 5_000,
    });

    const facts = await recallFactsForQuery('continue with the current summary', {
      conversationId,
      limit: 6,
      now: 6_000,
    });

    expect(facts).toHaveLength(0);
  });

  it('keeps recent current conversation facts available for anchored followups', async () => {
    const user = upsertEntity({ name: 'beam-user', type: 'person' });
    const team = upsertEntity({ name: 'beam-team', type: 'concept' });
    const conversationId = 'conv-current-state';

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

    const facts = await recallFactsForQuery('BEAM route meal window channel summary', {
      conversationId,
      limit: 6,
      now: 6_000,
    });
    const values = facts.map((fact) => fact.objectText);

    expect(values).toEqual(
      expect.arrayContaining(['BEAM-ROUTE-A', 'BEAM-MEAL-NEW', 'BEAM-WINDOW-9', 'BEAM-CHANNEL-7']),
    );
    expect(values).not.toContain('BEAM-MEAL-OLD');
  });

  it('admits quoted-anchor candidates before broad lexical distractors', async () => {
    const project = upsertEntity({ name: 'anchor-project', type: 'project' });
    const target = recordFact({
      subjectId: project.id,
      predicate: 'observed_state',
      objectText: 'ALPHA-PANEL-VALUE is visible in Alpha Panel.',
      scope: 'global',
      importance: 0.1,
      now: 1,
    });
    for (let index = 0; index < 20; index += 1) {
      recordFact({
        subjectId: project.id,
        predicate: `distractor_${index}`,
        objectText:
          index % 2 === 0
            ? `Alpha account summary order number completed distractor ${index}`
            : `Panel account summary order number completed distractor ${index}`,
        scope: 'global',
        importance: 0.9,
        now: 10_000 + index,
      });
    }

    const facts = await recallFactsForQuery(
      'What value is shown under "Alpha Panel" account summary order number completed?',
      {
        limit: 1,
        candidatePoolLimit: 3,
        now: 20_000,
      },
    );

    expect(facts.map((fact) => fact.id)).toContain(target.fact.id);
  });

  it('recalls relevant older facts beyond the newest tail candidate window', async () => {
    const project = upsertEntity({ name: 'project-tail', type: 'project' });
    const target = recordFact({
      subjectId: project.id,
      predicate: 'handoff_token',
      objectText: 'TAIL-ANCHOR-RELEVANT',
      scope: 'global',
      now: 1,
    });
    for (let index = 0; index < 650; index += 1) {
      recordFact({
        subjectId: project.id,
        predicate: `recent_noise_${index}`,
        objectText: `TAIL-NOISE-${index}`,
        scope: 'global',
        now: 10_000 + index,
      });
    }

    const facts = await recallFactsForQuery('TAIL-ANCHOR-RELEVANT handoff token', {
      limit: 3,
      now: 20_000,
    });

    expect(facts.map((fact) => fact.id)).toContain(target.fact.id);
  });

  it('demotes stale low-importance facts behind recent important facts', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const now = 200 * 24 * 60 * 60 * 1000;
    const stale = recordFact({
      subjectId: user.id,
      predicate: 'prefers_editor',
      objectText: 'Vim for coding',
      importance: 0.1,
      decayPolicy: 'fast',
      now: 1,
    });
    const recent = recordFact({
      subjectId: user.id,
      predicate: 'prefers_editor',
      objectText: 'VS Code for coding',
      importance: 0.9,
      now: now - 1_000,
    });

    const facts = await recallFactsForQuery('coding editor preference', {
      now,
      limit: 2,
    });

    expect(facts[0].id).toBe(recent.fact.id);
    expect(facts.map((fact) => fact.id)[0]).not.toBe(stale.fact.id);
  });

  it('does not reinforce facts before prompt policy admits them', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const recorded = recordFact({
      subjectId: user.id,
      predicate: 'prefers_tone',
      objectText: 'concise implementation notes',
      now: 100_000,
    });

    await recallFactsForQuery('concise implementation notes', { now: 123_000 });
    const refreshed = getFactById(recorded.fact.id);

    expect(refreshed?.accessCount).toBe(0);
    expect(refreshed?.lastRecalledAt).toBeNull();
  });

  it('does not update access counters when only scoring recall candidates', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const recorded = recordFact({
      subjectId: user.id,
      predicate: 'prefers_tone',
      objectText: 'concise implementation notes',
      now: 100_000,
    });

    const scored = await recallScoredFactsForQuery('concise implementation notes', {
      now: 123_000,
    });
    const refreshed = getFactById(recorded.fact.id);

    expect(scored.length).toBeGreaterThan(0);
    expect(refreshed?.accessCount).toBe(0);
    expect(refreshed?.lastRecalledAt).toBeNull();
  });
});
