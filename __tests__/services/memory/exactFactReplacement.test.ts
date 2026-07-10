jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  invalidateFact,
  recordFact,
  replaceCurrentFact,
} from '../../../src/services/memory/facts/mutations';
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

function replacement(expectedCurrentFactId: string, value: string, now: number) {
  return replaceCurrentFact({
    expectedCurrentFactId,
    subjectId: 'entity-user',
    predicate: 'lives_in',
    objectText: value,
    scope: 'global',
    originConversationId: 'conversation-1',
    originThreadId: 'thread-1',
    sourceMessageId: `user-${now}`,
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
