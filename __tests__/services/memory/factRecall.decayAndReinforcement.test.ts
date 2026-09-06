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
