jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  invalidateFact,
  recordFact,
  replaceCurrentFact,
} from '../../../src/services/memory/facts/mutations';
import { addFactEvidence } from '../../../src/services/memory/episodes/mutations';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

function replacement(
  expectedCurrentFactId: string,
  value: string,
  now: number,
  sourceMessageId = `user-${now}`,
) {
  return replaceCurrentFact({
    expectedCurrentFactId,
    subjectId: 'entity-user',
    predicate: 'lives_in',
    objectText: value,
    scope: 'global',
    originConversationId: 'conversation-1',
    originThreadId: 'thread-1',
    sourceMessageId,
    now,
  });
}

describe('replaceCurrentFact', () => {
  it('replaces only the exact current target and preserves history', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Amsterdam',
      scope: 'global',
      now: 100,
    });
    const scoped = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Hotel',
      scope: 'conversation',
      originConversationId: 'conversation-1',
      originThreadId: 'thread-1',
      now: 110,
    });

    const result = replacement(old.fact.id, 'Utrecht', 200);

    expect(result).toMatchObject({
      status: 'created',
      fact: { objectText: 'Utrecht' },
      superseded: [{ id: old.fact.id, invalidAt: 200 }],
    });
    expect(listFacts({ subjectId: 'entity-user', predicate: 'lives_in' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: scoped.fact.id, objectText: 'Hotel' }),
        expect.objectContaining({ objectText: 'Utrecht' }),
      ]),
    );
    expect(listFacts({ subjectId: 'entity-user', predicate: 'lives_in', asOf: 150 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: old.fact.id, objectText: 'Amsterdam' }),
      ]),
    );
  });

  it('returns a conflict without inserting when the admitted target changed', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Amsterdam',
      now: 100,
    });
    invalidateFact(old.fact.id, 150);

    expect(replacement(old.fact.id, 'Utrecht', 200)).toEqual({
      fact: null,
      status: 'conflict',
      superseded: [],
      conflict: 'target_changed',
    });
    expect(listFacts({ subjectId: 'entity-user', predicate: 'lives_in' })).toEqual([]);
  });

  it('rejects scope mismatch without invalidating the target', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Amsterdam',
      scope: 'conversation',
      originConversationId: 'conversation-1',
      originThreadId: 'thread-1',
      now: 100,
    });

    expect(replacement(old.fact.id, 'Utrecht', 200)).toMatchObject({
      status: 'conflict',
      conflict: 'target_scope_mismatch',
    });
    expect(listFacts({ subjectId: 'entity-user', predicate: 'lives_in' })).toEqual([
      expect.objectContaining({ id: old.fact.id, objectText: 'Amsterdam' }),
    ]);
  });

  it('replaces conversation memory across thread and task changes in one namespace', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'preferred_name',
      objectText: 'Mo',
      scope: 'conversation',
      originConversationId: 'conversation-1',
      originThreadId: 'older-thread',
      originTaskId: 'older-task',
      now: 100,
    });

    const result = replaceCurrentFact({
      expectedCurrentFactId: old.fact.id,
      subjectId: 'entity-user',
      predicate: 'preferred_name',
      objectText: 'Mohamed',
      scope: 'conversation',
      originConversationId: 'conversation-1',
      originThreadId: 'new-thread',
      originTaskId: 'new-task',
      now: 200,
    });

    expect(result).toMatchObject({ status: 'created', fact: { objectText: 'Mohamed' } });
  });

  it('keeps session replacements isolated to their exact thread and task', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'draft_state',
      objectText: 'open',
      scope: 'session',
      originConversationId: 'conversation-1',
      originThreadId: 'thread-1',
      originTaskId: 'task-1',
      now: 100,
    });

    expect(
      replaceCurrentFact({
        expectedCurrentFactId: old.fact.id,
        subjectId: 'entity-user',
        predicate: 'draft_state',
        objectText: 'done',
        scope: 'session',
        originConversationId: 'conversation-1',
        originThreadId: 'thread-2',
        originTaskId: 'task-1',
        now: 200,
      }),
    ).toMatchObject({ status: 'conflict', conflict: 'target_scope_mismatch' });
  });

  it('deduplicates an identical replacement without adding a history row', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      scope: 'global',
      now: 100,
    });

    const result = replacement(old.fact.id, 'Utrecht', 200);
    expect(result).toMatchObject({ status: 'duplicate', fact: { id: old.fact.id } });
    expect(listFacts({ subjectId: 'entity-user', includeInvalidated: true })).toHaveLength(1);
  });

  it('counts one grounded same-value mention once across replay but reinforces a later source', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      scope: 'global',
      now: 100,
    });
    const unrelated = recordFact({
      subjectId: 'entity-release',
      predicate: 'target',
      objectText: 'production',
      scope: 'global',
      now: 110,
    });
    addFactEvidence({
      factId: unrelated.fact.id,
      messageId: 'user-correction-1',
      quote: 'Ship to production.',
      now: 120,
    });

    const first = replacement(old.fact.id, 'Utrecht', 200, 'user-correction-1');
    expect(first).toMatchObject({
      status: 'duplicate',
      fact: { repeatedMentionCount: 1, updatedAt: 200 },
    });
    addFactEvidence({
      factId: old.fact.id,
      messageId: 'user-correction-1',
      quote: 'I still live in Utrecht.',
      now: 200,
    });

    const replay = replacement(old.fact.id, 'Utrecht', 250, 'user-correction-1');
    expect(replay).toMatchObject({
      status: 'duplicate',
      fact: { repeatedMentionCount: 1, updatedAt: 200 },
    });

    const laterMention = replacement(old.fact.id, 'Utrecht', 300, 'user-correction-2');
    expect(laterMention).toMatchObject({
      status: 'duplicate',
      fact: { repeatedMentionCount: 2, updatedAt: 300 },
    });
    addFactEvidence({
      factId: old.fact.id,
      messageId: 'user-correction-2',
      quote: 'I still live in Utrecht.',
      now: 300,
    });
    expect(replacement(old.fact.id, 'Utrecht', 350, 'user-correction-2')).toMatchObject({
      status: 'duplicate',
      fact: { repeatedMentionCount: 2, updatedAt: 300 },
    });
    expect(listFacts({ subjectId: 'entity-user', includeInvalidated: true })).toHaveLength(1);
  });

  it('supports repeated A to B to A validity intervals', () => {
    const firstA = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Amsterdam',
      scope: 'global',
      now: 100,
    });
    const b = replacement(firstA.fact.id, 'Utrecht', 200);
    expect(b.status).toBe('created');
    if (b.status !== 'created') throw new Error('expected first replacement');

    const secondA = replacement(b.fact.id, 'Amsterdam', 300);
    expect(secondA).toMatchObject({ status: 'created', fact: { objectText: 'Amsterdam' } });
    const history = listFacts({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      includeInvalidated: true,
    });
    expect(history).toHaveLength(3);
    expect(history.filter((fact) => fact.objectText === 'Amsterdam')).toHaveLength(2);
    expect(listFacts({ subjectId: 'entity-user', predicate: 'lives_in', asOf: 250 })).toEqual([
      expect.objectContaining({ objectText: 'Utrecht' }),
    ]);
    expect(listFacts({ subjectId: 'entity-user', predicate: 'lives_in', asOf: 350 })).toEqual([
      expect.objectContaining({ objectText: 'Amsterdam' }),
    ]);
  });

  it('stores a case-only opaque value correction as a new validity interval', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'access_token',
      objectText: 'AbC',
      scope: 'global',
      now: 100,
    });

    const result = replaceCurrentFact({
      expectedCurrentFactId: old.fact.id,
      subjectId: 'entity-user',
      predicate: 'access_token',
      objectText: 'abc',
      scope: 'global',
      now: 200,
    });

    expect(result).toMatchObject({ status: 'created', fact: { objectText: 'abc' } });
    const history = listFacts({
      subjectId: 'entity-user',
      predicate: 'access_token',
      includeInvalidated: true,
    });
    expect(history).toHaveLength(2);
    expect(history.map((fact) => fact.objectText)).toEqual(expect.arrayContaining(['abc', 'AbC']));
  });

  it('rolls back when the replacement would collide with another active fact', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Amsterdam',
      scope: 'global',
      now: 100,
    });
    const alreadyCurrent = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      scope: 'global',
      now: 110,
    });

    expect(replacement(old.fact.id, 'Utrecht', 200)).toEqual({
      fact: null,
      status: 'conflict',
      superseded: [],
      conflict: 'replacement_collision',
    });
    expect(listFacts({ subjectId: 'entity-user', predicate: 'lives_in' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: old.fact.id }),
        expect.objectContaining({ id: alreadyCurrent.fact.id }),
      ]),
    );
  });
});
