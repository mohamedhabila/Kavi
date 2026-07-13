jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  replaceCurrentFact,
  replaceCurrentFactWithApplicability,
} from '../../../src/services/memory/facts/exactReplacement';
import {
  invalidateFact,
  recordFact,
  recordFactWithApplicability,
} from '../../../src/services/memory/facts/mutations';
import { addFactEvidence } from '../../../src/services/memory/episodes/mutations';
import {
  listCurrentFactsForPriorUserSelfCorrection,
  listCurrentFactsForReplacement,
  MEMORY_FACT_REPLACEMENT_SCAN_LIMIT,
  PRIOR_USER_SELF_CORRECTION_SCAN_LIMIT,
} from '../../../src/services/memory/facts/exactReplacementQueries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';

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
      scope: 'global',
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

  it('rejects a replacement whose source validity precedes the current fact', () => {
    const current = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      scope: 'global',
      now: 200,
    });

    expect(replacement(current.fact.id, 'Amsterdam', 100)).toEqual({
      fact: null,
      status: 'conflict',
      superseded: [],
      conflict: 'stale_source_order',
    });
    expect(listFacts({ subjectId: 'entity-user', predicate: 'lives_in' })).toEqual([
      expect.objectContaining({ id: current.fact.id, objectText: 'Utrecht', invalidAt: null }),
    ]);
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

  it('replaces conversation memory across thread changes in one root namespace', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'preferred_name',
      objectText: 'Mo',
      scope: 'conversation',
      originConversationId: 'conversation-1',
      originThreadId: 'older-thread',
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
      now: 200,
    });

    expect(result).toMatchObject({ status: 'created', fact: { objectText: 'Mohamed' } });
  });

  it('replaces project memory across thread changes in one root namespace', () => {
    const old = recordFact({
      subjectId: 'entity-project',
      predicate: 'release_target',
      objectText: 'staging',
      scope: 'project',
      originConversationId: 'project-root',
      originThreadId: 'older-thread',
      now: 100,
    });

    expect(
      replaceCurrentFact({
        expectedCurrentFactId: old.fact.id,
        subjectId: 'entity-project',
        predicate: 'release_target',
        objectText: 'production',
        scope: 'project',
        originConversationId: 'project-root',
        originThreadId: 'new-thread',
        now: 200,
      }),
    ).toMatchObject({ status: 'created', fact: { objectText: 'production' } });
  });

  it('rejects structurally malformed persisted scope bindings without collateral mutation', () => {
    const global = recordFact({
      subjectId: 'entity-global',
      predicate: 'state',
      objectText: 'old',
      scope: 'global',
      now: 100,
    }).fact;
    const persona = recordFactWithApplicability(
      {
        subjectId: 'entity-persona',
        predicate: 'state',
        objectText: 'old',
        scope: 'persona',
        now: 100,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user', personaId: 'persona-1' },
    ).fact;
    const conversation = recordFact({
      subjectId: 'entity-conversation',
      predicate: 'state',
      objectText: 'old',
      scope: 'conversation',
      originConversationId: 'root-1',
      now: 100,
    }).fact;
    const project = recordFact({
      subjectId: 'entity-project-malformed',
      predicate: 'state',
      objectText: 'old',
      scope: 'project',
      originConversationId: 'root-1',
      now: 100,
    }).fact;
    const session = recordFact({
      subjectId: 'entity-session',
      predicate: 'state',
      objectText: 'old',
      scope: 'session',
      originConversationId: 'root-1',
      originThreadId: 'thread-1',
      originTaskId: 'task-1',
      now: 100,
    }).fact;
    const db = getMemoryDb();
    db.runSync(
      'UPDATE memory_facts SET origin_conversation_id = ? WHERE id = ?',
      'root-1',
      global.id,
    );
    db.runSync('UPDATE memory_facts SET origin_thread_id = ? WHERE id = ?', 'thread-1', persona.id);
    db.runSync(
      'UPDATE memory_facts SET origin_task_id = ? WHERE id = ?',
      'task-1',
      conversation.id,
    );
    db.runSync('UPDATE memory_facts SET persona_id = ? WHERE id = ?', 'persona-1', project.id);
    db.runSync('UPDATE memory_facts SET origin_task_id = NULL WHERE id = ?', session.id);

    const results = [
      replaceCurrentFact({
        expectedCurrentFactId: global.id,
        subjectId: global.subjectId,
        predicate: global.predicate,
        objectText: 'new',
        scope: 'global',
        now: 200,
      }),
      replaceCurrentFactWithApplicability(
        {
          expectedCurrentFactId: persona.id,
          subjectId: persona.subjectId,
          predicate: persona.predicate,
          objectText: 'new',
          scope: 'persona',
          now: 200,
        },
        {
          factClass: 'subjective_user',
          sourceAuthority: 'grounded_user',
          personaId: 'persona-1',
        },
      ),
      replaceCurrentFact({
        expectedCurrentFactId: conversation.id,
        subjectId: conversation.subjectId,
        predicate: conversation.predicate,
        objectText: 'new',
        scope: 'conversation',
        originConversationId: 'root-1',
        now: 200,
      }),
      replaceCurrentFact({
        expectedCurrentFactId: project.id,
        subjectId: project.subjectId,
        predicate: project.predicate,
        objectText: 'new',
        scope: 'project',
        originConversationId: 'root-1',
        now: 200,
      }),
      replaceCurrentFact({
        expectedCurrentFactId: session.id,
        subjectId: session.subjectId,
        predicate: session.predicate,
        objectText: 'new',
        scope: 'session',
        originConversationId: 'root-1',
        originThreadId: 'thread-1',
        originTaskId: 'task-1',
        now: 200,
      }),
    ];

    expect(results).toEqual(
      results.map(() =>
        expect.objectContaining({ status: 'conflict', conflict: 'target_scope_mismatch' }),
      ),
    );
    const rows = db.getAllSync<{ invalid_at: number | null }>(
      `SELECT invalid_at FROM memory_facts
        WHERE id IN (?, ?, ?, ?, ?)`,
      global.id,
      persona.id,
      conversation.id,
      project.id,
      session.id,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.invalid_at === null)).toBe(true);
  });

  it('filters foreign and malformed rows before the two-row replacement bound', () => {
    const target = recordFact({
      subjectId: 'entity-saturated',
      predicate: 'state',
      objectText: 'valid',
      scope: 'conversation',
      originConversationId: 'root-1',
      originThreadId: 'thread-1',
      now: 100,
    }).fact;
    if (!target.memoryOwnerId) throw new Error('expected local memory owner');
    const db = getMemoryDb();
    for (let index = 0; index < 300; index += 1) {
      const timestamp = 1_000 + index;
      db.runSync(
        `INSERT INTO memory_facts(
          id, subject_id, predicate, object_text, content_hash, valid_at, created_at,
          updated_at, scope, origin_conversation_id, origin_thread_id, origin_task_id,
          memory_owner_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'conversation', 'root-1', 'thread-1', ?, ?)`,
        `foreign-${index}`,
        target.subjectId,
        target.predicate,
        `foreign-${index}`,
        `foreign-hash-${index}`,
        timestamp,
        timestamp,
        timestamp,
        null,
        'foreign-owner',
      );
      db.runSync(
        `INSERT INTO memory_facts(
          id, subject_id, predicate, object_text, content_hash, valid_at, created_at,
          updated_at, scope, origin_conversation_id, origin_thread_id, origin_task_id,
          memory_owner_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'conversation', 'root-1', 'thread-1', ?, ?)`,
        `malformed-${index}`,
        target.subjectId,
        target.predicate,
        `malformed-${index}`,
        `malformed-hash-${index}`,
        timestamp,
        timestamp,
        timestamp,
        null,
        target.memoryOwnerId,
      );
      db.runSync(
        "UPDATE memory_facts SET origin_thread_id = ' invalid-thread ' WHERE id = ?",
        `malformed-${index}`,
      );
    }

    expect(
      listCurrentFactsForReplacement({
        subjectId: target.subjectId,
        predicate: target.predicate,
        scope: 'conversation',
        originConversationId: 'root-1',
        originThreadId: 'thread-1',
      }).map((fact) => fact.id),
    ).toEqual([target.id]);
  });

  it('fails closed when exact replacement corruption scanning saturates', () => {
    const target = recordFact({
      subjectId: 'entity-corruption-saturation',
      predicate: 'state',
      objectText: 'valid',
      scope: 'conversation',
      originConversationId: 'root-1',
      now: 100,
    }).fact;
    if (!target.memoryOwnerId) throw new Error('expected local memory owner');
    const db = getMemoryDb();
    for (let index = 0; index <= MEMORY_FACT_REPLACEMENT_SCAN_LIMIT; index += 1) {
      db.runSync(
        `INSERT INTO memory_facts(
          id, subject_id, predicate, object_text, content_hash, valid_at, created_at,
          updated_at, scope, origin_conversation_id, origin_thread_id, origin_task_id,
          memory_owner_id
        ) VALUES (?, ?, ?, ?, ?, 200, 200, 200, 'conversation', 'root-1',
                  ' invalid-thread ', NULL, ?)`,
        `saturated-${index}`,
        target.subjectId,
        target.predicate,
        `saturated-${index}`,
        `saturated-hash-${index}`,
        target.memoryOwnerId,
      );
    }

    expect(() =>
      listCurrentFactsForReplacement({
        subjectId: target.subjectId,
        predicate: target.predicate,
        scope: 'conversation',
        originConversationId: 'root-1',
      }),
    ).toThrow('memory_fact_replacement_scan_saturated');
  });

  it('bounds immediately-prior grounded correction candidates', () => {
    for (let index = 0; index <= PRIOR_USER_SELF_CORRECTION_SCAN_LIMIT; index += 1) {
      recordFactWithApplicability(
        {
          subjectId: 'entity-prior-correction-saturation',
          predicate: `preference_${index}`,
          objectText: `value ${index}`,
          scope: 'global',
          sourceMessageId: 'user-prior-correction-saturation',
          now: 100 + index,
        },
        { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
      );
    }

    expect(() =>
      listCurrentFactsForPriorUserSelfCorrection({
        subjectId: 'entity-prior-correction-saturation',
        sourceMessageId: 'user-prior-correction-saturation',
        scope: 'global',
      }),
    ).toThrow('memory_prior_user_correction_scan_saturated');
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

  it('applies a sealed grounded upgrade even when same-value source evidence already exists', () => {
    const inferred = recordFactWithApplicability(
      {
        subjectId: 'entity-user',
        predicate: 'timezone',
        objectText: 'Europe/Amsterdam',
        scope: 'global',
        sourceMessageId: 'user-timezone-1',
        now: 100,
      },
      { factClass: 'workflow', sourceAuthority: 'assistant_inferred' },
    );
    addFactEvidence({
      factId: inferred.fact.id,
      messageId: 'user-timezone-1',
      quote: 'My timezone is Europe/Amsterdam.',
      now: 110,
    });

    const grounded = replaceCurrentFactWithApplicability(
      {
        expectedCurrentFactId: inferred.fact.id,
        subjectId: 'entity-user',
        predicate: 'timezone',
        objectText: 'Europe/Amsterdam',
        scope: 'global',
        sourceMessageId: 'user-timezone-1',
        now: 200,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );

    expect(grounded).toMatchObject({
      status: 'duplicate',
      fact: {
        id: inferred.fact.id,
        factClass: 'subjective_user',
        sourceAuthority: 'grounded_user',
        repeatedMentionCount: 0,
      },
    });
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
      predicate: 'display_label',
      objectText: 'AbC',
      scope: 'global',
      now: 100,
    });

    const result = replaceCurrentFact({
      expectedCurrentFactId: old.fact.id,
      subjectId: 'entity-user',
      predicate: 'display_label',
      objectText: 'abc',
      scope: 'global',
      now: 200,
    });

    expect(result).toMatchObject({ status: 'created', fact: { objectText: 'abc' } });
    const history = listFacts({
      subjectId: 'entity-user',
      predicate: 'display_label',
      includeInvalidated: true,
    });
    expect(history).toHaveLength(2);
    expect(history.map((fact) => fact.objectText)).toEqual(expect.arrayContaining(['abc', 'AbC']));
  });
});
