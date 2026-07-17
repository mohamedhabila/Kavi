jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  replaceCurrentFact,
  replaceCurrentFactWithApplicability,
} from '../../../src/services/memory/facts/exactReplacement';
import {
  recordFact,
  recordFactWithApplicability,
} from '../../../src/services/memory/facts/mutations';
import {
  raiseScopedMemoryFactSensitivityFloor,
  setManagedMemoryFactPinned,
  setScopedMemoryFactReviewState,
} from '../../../src/services/memory/factExplicitOverrides';
import { addFactEvidence } from '../../../src/services/memory/episodes/mutations';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../src/services/memory/memoryAuthority';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const OVERRIDE_SQL = 'SELECT * FROM memory_fact_explicit_overrides WHERE fact_id = ?';
const PROJECTION_SQL =
  'SELECT pinned, review_state, sensitivity, repeated_mention_count, updated_at FROM memory_facts WHERE id = ?';

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

function replaceGlobalLocationFact(
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

function recordGlobalLocationFact(objectText: string, now: number, sourceMessageId?: string) {
  return recordFact({
    subjectId: 'entity-user',
    predicate: 'lives_in',
    objectText,
    scope: 'global',
    sourceMessageId,
    now,
  });
}

function requireMemoryAuthority() {
  const authority = captureMemoryAuthoritySnapshot();
  if (!authority) throw new Error('expected enabled memory authority');
  return authority;
}

describe('replaceCurrentFact same-value handling', () => {
  it('deduplicates an identical replacement without adding a history row', () => {
    const old = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      scope: 'global',
      confidence: 0.2,
      importance: 0.1,
      retrievability: 0.25,
      stability: 0.15,
      decayRate: 0.8,
      now: 100,
    });

    const beforeDuplicate = requireMemoryAuthority();
    const result = replaceGlobalLocationFact(old.fact.id, 'Utrecht', 200);
    expect(result).toMatchObject({
      status: 'duplicate',
      fact: {
        id: old.fact.id,
        confidence: 0.2,
        importance: 0.1,
        retrievability: 0.25,
        stability: 0.15,
        decayRate: 0.8,
      },
    });
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeDuplicate)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeDuplicate)).toBe(true);
    expect(listFacts({ subjectId: 'entity-user', includeInvalidated: true })).toHaveLength(1);
  });

  it('creates a successor when the same text explicitly changes memory kind', () => {
    const current = recordGlobalLocationFact('Utrecht', 100).fact;
    const beforeReplacement = requireMemoryAuthority();

    const result = replaceCurrentFact({
      expectedCurrentFactId: current.id,
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      scope: 'global',
      memoryKind: 'decision',
      now: 200,
    });

    expect(result).toMatchObject({
      status: 'created',
      fact: { objectText: 'Utrecht', memoryKind: 'decision' },
      superseded: [{ id: current.id, invalidAt: 200 }],
    });
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeReplacement)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeReplacement)).toBe(false);
    if (result.status !== 'created') throw new Error('expected memory-kind successor');
    expect(result.fact.id).not.toBe(current.id);
  });

  it('revokes prepared memory when generic supersession changes the active fact', () => {
    const current = recordGlobalLocationFact('Utrecht', 100).fact;
    const beforeSupersession = requireMemoryAuthority();

    const successor = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Rotterdam',
      scope: 'global',
      supersedePrior: true,
      now: 200,
    });

    expect(successor).toMatchObject({
      status: 'created',
      superseded: [{ id: current.id, invalidAt: 200 }],
    });
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeSupersession)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeSupersession)).toBe(false);
  });

  it('refreshes future retrieval without revoking admitted work for a ranking change', () => {
    recordFact({
      subjectId: 'entity-user',
      predicate: 'timezone',
      objectText: 'Europe/Amsterdam',
      scope: 'global',
      confidence: 0.2,
      sourceMessageId: 'timezone-source-1',
      now: 100,
    });
    const beforeUpgrade = requireMemoryAuthority();

    const upgraded = recordFact({
      subjectId: 'entity-user',
      predicate: 'timezone',
      objectText: 'Europe/Amsterdam',
      scope: 'global',
      confidence: 0.9,
      sourceMessageId: 'timezone-source-2',
      now: 200,
    });

    expect(upgraded).toMatchObject({ status: 'duplicate', fact: { confidence: 0.9 } });
    expect(isMemoryProjectionSnapshotCurrent(beforeUpgrade)).toBe(false);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeUpgrade)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeUpgrade)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeUpgrade)).toBe(true);
  });

  it('creates a successor when the same text explicitly changes object entity', () => {
    const current = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      objectEntityId: 'entity-utrecht-v1',
      scope: 'global',
      now: 100,
    }).fact;

    const result = replaceCurrentFact({
      expectedCurrentFactId: current.id,
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      objectEntityId: 'entity-utrecht-v2',
      scope: 'global',
      now: 200,
    });

    expect(result).toMatchObject({
      status: 'created',
      fact: { objectEntityId: 'entity-utrecht-v2' },
      superseded: [{ id: current.id, invalidAt: 200 }],
    });
    if (result.status !== 'created') throw new Error('expected object-entity successor');
    expect(result.fact.id).not.toBe(current.id);
  });

  it('preserves the current object entity when an exact duplicate omits it', () => {
    const current = recordFact({
      subjectId: 'entity-user',
      predicate: 'lives_in',
      objectText: 'Utrecht',
      objectEntityId: 'entity-utrecht',
      scope: 'global',
      now: 100,
    }).fact;

    expect(replaceGlobalLocationFact(current.id, 'Utrecht', 200)).toMatchObject({
      status: 'duplicate',
      fact: { id: current.id, objectEntityId: 'entity-utrecht' },
      superseded: [],
    });
    expect(listFacts({ subjectId: 'entity-user', includeInvalidated: true })).toHaveLength(1);
  });

  it('rolls back when the exact target cannot enter the duplicate materializer', () => {
    const old = recordGlobalLocationFact('Utrecht', 100);
    getMemoryDb().runSync(
      "UPDATE memory_facts SET content_hash = 'corrupt-target-hash' WHERE id = ?",
      old.fact.id,
    );

    expect(replaceGlobalLocationFact(old.fact.id, 'Utrecht', 200)).toEqual({
      fact: null,
      status: 'conflict',
      superseded: [],
      conflict: 'replacement_collision',
    });
    expect(listFacts({ subjectId: 'entity-user', includeInvalidated: true })).toHaveLength(1);
  });

  it('repairs canonical projection drift on an evidenced same-value replay', () => {
    const sourceId = 'user-canonical-replay';
    const fact = recordGlobalLocationFact('Utrecht', 100, sourceId).fact;
    const currentScope = resolveLocalMemoryAccessScope({
      memoryConversationId: 'r',
      sourceThreadId: 't',
      personaId: 'p',
      taskId: null,
    });
    setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 150 });
    setScopedMemoryFactReviewState({
      factId: fact.id,
      currentScope,
      reviewState: 'verified',
      now: 160,
    });
    raiseScopedMemoryFactSensitivityFloor({
      factId: fact.id,
      currentScope,
      sensitivityFloor: 'sensitive',
      now: 170,
    });
    addFactEvidence({ factId: fact.id, messageId: sourceId, quote: 'Utrecht', now: 180 });
    const db = getMemoryDb();
    const sidecarBefore = db.getFirstSync(OVERRIDE_SQL, fact.id);
    const projectionBefore = db.getFirstSync(PROJECTION_SQL, fact.id);
    db.runSync(
      "UPDATE memory_facts SET pinned = 0, review_state = 'auto', sensitivity = 'normal' WHERE id = ?",
      fact.id,
    );
    const beforeRepair = requireMemoryAuthority();

    expect(replaceGlobalLocationFact(fact.id, 'Utrecht', 300, sourceId)).toMatchObject({
      status: 'duplicate',
      fact: {
        pinned: true,
        reviewState: 'verified',
        sensitivity: 'sensitive',
        repeatedMentionCount: 0,
        updatedAt: 100,
      },
    });
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeRepair)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeRepair)).toBe(false);
    expect(db.getFirstSync(PROJECTION_SQL, fact.id)).toEqual(projectionBefore);
    expect(db.getFirstSync(OVERRIDE_SQL, fact.id)).toEqual(sidecarBefore);
  });

  it('counts one grounded same-value mention once across replay but reinforces a later source', () => {
    const old = recordGlobalLocationFact('Utrecht', 100);
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

    const first = replaceGlobalLocationFact(old.fact.id, 'Utrecht', 200, 'user-correction-1');
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

    const replay = replaceGlobalLocationFact(old.fact.id, 'Utrecht', 250, 'user-correction-1');
    expect(replay).toMatchObject({
      status: 'duplicate',
      fact: { repeatedMentionCount: 1, updatedAt: 200 },
    });

    const laterMention = replaceGlobalLocationFact(
      old.fact.id,
      'Utrecht',
      300,
      'user-correction-2',
    );
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
    expect(
      replaceGlobalLocationFact(old.fact.id, 'Utrecht', 350, 'user-correction-2'),
    ).toMatchObject({
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
});
