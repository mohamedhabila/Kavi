jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { replaceCurrentFact } from '../../../src/services/memory/facts/exactReplacement';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { getFactById, listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { subscribeToMemoryChanges } from '../../../src/services/memory/changeNotifications';

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
    sourceMessageId: `user-${now}`,
    now,
  });
}

describe('replaceCurrentFact safety invariants', () => {
  it('never downgrades a prior sensitivity floor during replacement', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'display_label',
      objectText: 'old label',
      scope: 'global',
      now: 100,
    });
    getMemoryDb().runSync(
      "UPDATE memory_facts SET sensitivity = 'sensitive' WHERE id = ?",
      old.fact.id,
    );

    const result = replaceCurrentFact({
      expectedCurrentFactId: old.fact.id,
      subjectId: 'entity-user',
      predicate: 'display_label',
      objectText: 'new label',
      scope: 'global',
      now: 200,
    });

    expect(result).toMatchObject({
      status: 'created',
      fact: { objectText: 'new label', sensitivity: 'sensitive' },
    });
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
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

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
    expect(getFactById(alreadyCurrent.fact.id)?.repeatedMentionCount).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
