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
import { recallFactsForQuery as recallFactsForQueryImpl } from '../../../src/services/memory/factRecall';
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

  it('excludes internal control-plane results from reusable experience recall', async () => {
    const subject = upsertEntity({ name: 'message-contact', type: 'concept' });
    const internal = recordFact({
      subjectId: subject.id,
      predicate: 'evidence_span',
      objectText: '{"value":"Morgan","toolName":"memory_remember"}',
      attributes: { toolName: 'memory_remember' },
      memoryKind: 'evidence_span',
      scope: 'conversation',
      originConversationId: 'fact-recall-root',
      originThreadId: 'fact-recall-root',
    });
    const external = recordFact({
      subjectId: subject.id,
      predicate: 'evidence_span',
      objectText: '{"value":"Avery","toolName":"contacts_search"}',
      attributes: { toolName: 'contacts_search' },
      memoryKind: 'evidence_span',
      scope: 'conversation',
      originConversationId: 'fact-recall-root',
      originThreadId: 'fact-recall-root',
    });

    const facts = await recallFactsForQuery('message contact Morgan Avery');

    expect(facts.map((fact) => fact.id)).not.toContain(internal.fact.id);
    expect(facts.map((fact) => fact.id)).toContain(external.fact.id);
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
