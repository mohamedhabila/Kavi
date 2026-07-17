jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { subscribeToMemoryChanges } from '../../../src/services/memory/changeNotifications';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  invalidateManagedMemoryFact,
  invalidateScopedMemoryFact,
  raiseScopedMemoryFactSensitivityFloor,
  setManagedMemoryFactPinned,
  setScopedMemoryFactPinned,
  setScopedMemoryFactReviewState,
} from '../../../src/services/memory/factExplicitOverrides';
import {
  FactExplicitOverrideMutationError,
  loadFactExplicitOverrideInTransaction,
  overlayFactExplicitProjectionInTransaction,
} from '../../../src/services/memory/factExplicitOverrideState';
import { recordCodeOwnedTestFactWithContribution as recordFactWithContribution } from '../../helpers/factContributionWriteFixtures';
import type { MemoryFact, MemoryFactScope } from '../../../src/services/memory/facts/types';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

interface OverrideRow {
  pinned_override: number | null;
  pinned_at: number | null;
  review_state_override: string | null;
  review_state_at: number | null;
  sensitivity_floor: string | null;
  sensitivity_floor_at: number | null;
  explicit_invalidated_at: number | null;
  created_at: number;
  updated_at: number;
}

let nextFact = 0;

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  nextFact = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function seedFact(
  input: {
    scope?: MemoryFactScope;
    rootId?: string;
    threadId?: string;
    taskId?: string;
    personaId?: string;
    pinned?: boolean;
    reviewState?: 'auto' | 'verified' | 'pending_review' | 'stale' | 'conflicted' | 'rejected';
  } = {},
): MemoryFact {
  nextFact += 1;
  const suffix = String(nextFact);
  const scope = input.scope ?? 'global';
  const subject = upsertEntity({ type: 'self', name: 'user', now: 100 });
  return recordFactWithContribution(
    {
      subjectId: subject.id,
      predicate: `explicit_override_${suffix}`,
      objectText: `value-${suffix}`,
      scope,
      ...(input.rootId ? { originConversationId: input.rootId } : {}),
      ...(input.threadId ? { originThreadId: input.threadId } : {}),
      ...(input.taskId ? { originTaskId: input.taskId } : {}),
      ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      ...(input.reviewState ? { reviewState: input.reviewState } : {}),
      sourceMessageId: `user-message-${suffix}`,
      sourceTurnId: `assistant-message-${suffix}`,
      now: 100,
    },
    {
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
      ...(input.personaId ? { personaId: input.personaId } : {}),
    },
    {
      memoryConversationId: input.rootId ?? 'root-a',
      sourceThreadId: input.threadId ?? 'thread-a',
      taskId: input.taskId ?? null,
      producer: {
        producerId: 'explicit_override_test',
        producerEventId: `assistant-message-${suffix}:0`,
      },
      sourceAliases: [
        { sourceKind: 'message', sourceId: `user-message-${suffix}` },
        { sourceKind: 'turn', sourceId: `assistant-message-${suffix}` },
      ],
    },
  ).fact;
}

function currentScope(
  overrides: {
    rootId?: string;
    threadId?: string;
    taskId?: string | null;
    personaId?: string;
    ownerId?: string;
  } = {},
) {
  return {
    memoryOwnerId: overrides.ownerId ?? getLocalMemoryVaultOwnerId(getMemoryDb()),
    memoryConversationId: overrides.rootId ?? 'root-a',
    sourceThreadId: overrides.threadId ?? 'thread-a',
    personaId: overrides.personaId ?? 'default',
    taskId: overrides.taskId ?? null,
  };
}

function overrideRow(factId: string): OverrideRow | null {
  return getMemoryDb().getFirstSync<OverrideRow>(
    `SELECT pinned_override, pinned_at, review_state_override, review_state_at,
            sensitivity_floor, sensitivity_floor_at, explicit_invalidated_at,
            created_at, updated_at
       FROM memory_fact_explicit_overrides WHERE fact_id = ? LIMIT 1`,
    factId,
  );
}

function factProjection(factId: string) {
  return getMemoryDb().getFirstSync<{
    pinned: number;
    review_state: string;
    sensitivity: string;
    sensitivity_policy_version: number;
    invalid_at: number | null;
    updated_at: number;
  }>(
    `SELECT pinned, review_state, sensitivity, sensitivity_policy_version,
            invalid_at, updated_at
       FROM memory_facts WHERE id = ? LIMIT 1`,
    factId,
  );
}

function expectMutationCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('expected mutation failure');
  } catch (error) {
    expect(error).toBeInstanceOf(FactExplicitOverrideMutationError);
    expect((error as FactExplicitOverrideMutationError).code).toBe(code);
  }
}

describe('canonical fact explicit overrides', () => {
  it('records explicit pin and unpin without retrieval timestamp churn', () => {
    const fact = seedFact();
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 200 })).toMatchObject({
      status: 'updated',
      fact: { pinned: true },
    });
    expect(setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 250 })).toMatchObject({
      status: 'unchanged',
    });
    expect(overrideRow(fact.id)).toMatchObject({
      pinned_override: 1,
      pinned_at: 200,
      created_at: 200,
      updated_at: 200,
    });
    expect(factProjection(fact.id)?.updated_at).toBe(100);

    expect(setManagedMemoryFactPinned({ factId: fact.id, pinned: false, now: 300 })).toMatchObject({
      status: 'updated',
      fact: { pinned: false },
    });
    expect(overrideRow(fact.id)).toMatchObject({
      pinned_override: 0,
      pinned_at: 300,
      created_at: 200,
      updated_at: 300,
    });
    expect(factProjection(fact.id)?.updated_at).toBe(100);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('records explicit unpin even when the projection is already false', () => {
    const fact = seedFact();
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(setManagedMemoryFactPinned({ factId: fact.id, pinned: false, now: 200 })).toMatchObject({
      status: 'updated',
      fact: { pinned: false },
    });
    expect(overrideRow(fact.id)).toMatchObject({ pinned_override: 0, pinned_at: 200 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps pin intent available for inactive but nondeleted facts', () => {
    const invalidated = seedFact();
    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = 150, updated_at = 150 WHERE id = ?',
      invalidated.id,
    );
    expect(
      setManagedMemoryFactPinned({ factId: invalidated.id, pinned: true, now: 200 }),
    ).toMatchObject({ status: 'updated', fact: { pinned: true, invalidAt: 150 } });

    const expired = seedFact({ scope: 'conversation', rootId: 'root-a', threadId: 'thread-a' });
    getMemoryDb().runSync('UPDATE memory_facts SET expires_at = 150 WHERE id = ?', expired.id);
    expect(
      setScopedMemoryFactPinned({
        factId: expired.id,
        currentScope: currentScope(),
        pinned: true,
        now: 200,
      }),
    ).toMatchObject({ status: 'updated', fact: { pinned: true, expiresAt: 150 } });
    expect(
      setScopedMemoryFactPinned({
        factId: expired.id,
        currentScope: currentScope(),
        pinned: false,
        now: 250,
      }),
    ).toMatchObject({ status: 'updated', fact: { pinned: false, expiresAt: 150 } });
  });

  it('authorizes scoped mutations against the exact durable scope and owner', () => {
    const fact = seedFact({
      scope: 'session',
      rootId: 'root-a',
      threadId: 'thread-a',
      taskId: 'task-a',
    });

    expectMutationCode(
      () =>
        setScopedMemoryFactPinned({
          factId: fact.id,
          currentScope: currentScope({ taskId: 'task-b' }),
          pinned: true,
          now: 200,
        }),
      'scope_mismatch',
    );
    expectMutationCode(
      () =>
        setScopedMemoryFactPinned({
          factId: fact.id,
          currentScope: currentScope({ taskId: 'task-a', ownerId: 'other-owner' }),
          pinned: true,
          now: 200,
        }),
      'owner_mismatch',
    );
    expect(overrideRow(fact.id)).toBeNull();

    expect(
      setScopedMemoryFactPinned({
        factId: fact.id,
        currentScope: currentScope({ taskId: 'task-a' }),
        pinned: true,
        now: 200,
      }),
    ).toMatchObject({ status: 'updated', fact: { pinned: true } });
  });

  it('rejects whole-vault management when the fact owner is foreign', () => {
    const fact = seedFact();
    getMemoryDb().runSync(
      "UPDATE memory_facts SET memory_owner_id = 'other-owner' WHERE id = ?",
      fact.id,
    );

    expectMutationCode(
      () => setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 200 }),
      'owner_mismatch',
    );
    expect(overrideRow(fact.id)).toBeNull();
  });

  it('records scoped review intent only for an active exact-scope fact', () => {
    const fact = seedFact({ scope: 'conversation', rootId: 'root-a', threadId: 'thread-a' });

    expect(
      setScopedMemoryFactReviewState({
        factId: fact.id,
        currentScope: currentScope(),
        reviewState: 'verified',
        now: 200,
      }),
    ).toMatchObject({ status: 'updated', fact: { reviewState: 'verified' } });
    expect(overrideRow(fact.id)).toMatchObject({
      review_state_override: 'verified',
      review_state_at: 200,
    });
    expect(factProjection(fact.id)).toMatchObject({ review_state: 'verified', updated_at: 100 });

    const expired = seedFact({ scope: 'conversation', rootId: 'root-a', threadId: 'thread-a' });
    getMemoryDb().runSync('UPDATE memory_facts SET expires_at = 150 WHERE id = ?', expired.id);
    expectMutationCode(
      () =>
        setScopedMemoryFactReviewState({
          factId: expired.id,
          currentScope: currentScope(),
          reviewState: 'verified',
          now: 200,
        }),
      'inactive',
    );
    expect(overrideRow(expired.id)).toBeNull();
  });

  it('raises but never lowers the explicit sensitivity floor', () => {
    const fact = seedFact();

    expect(
      raiseScopedMemoryFactSensitivityFloor({
        factId: fact.id,
        currentScope: currentScope(),
        sensitivityFloor: 'personal',
        now: 200,
      }),
    ).toMatchObject({ status: 'updated', fact: { sensitivity: 'personal' } });
    expect(
      raiseScopedMemoryFactSensitivityFloor({
        factId: fact.id,
        currentScope: currentScope(),
        sensitivityFloor: 'normal',
        now: 250,
      }),
    ).toMatchObject({ status: 'unchanged' });
    expect(overrideRow(fact.id)).toMatchObject({
      sensitivity_floor: 'personal',
      sensitivity_floor_at: 200,
    });

    expect(
      raiseScopedMemoryFactSensitivityFloor({
        factId: fact.id,
        currentScope: currentScope(),
        sensitivityFloor: 'sensitive',
        now: 300,
      }),
    ).toMatchObject({ status: 'updated', fact: { sensitivity: 'sensitive' } });
    expect(overrideRow(fact.id)).toMatchObject({
      sensitivity_floor: 'sensitive',
      sensitivity_floor_at: 300,
    });
  });

  it('keeps classifier and stale-policy protection above a lower explicit floor', () => {
    const restricted = seedFact();
    getMemoryDb().runSync(
      "UPDATE memory_facts SET sensitivity = 'restricted' WHERE id = ?",
      restricted.id,
    );
    expect(
      raiseScopedMemoryFactSensitivityFloor({
        factId: restricted.id,
        currentScope: currentScope(),
        sensitivityFloor: 'personal',
        now: 200,
      }),
    ).toMatchObject({ fact: { sensitivity: 'restricted' } });

    const stale = seedFact();
    getMemoryDb().runSync(
      "UPDATE memory_facts SET sensitivity = 'normal', sensitivity_policy_version = 1 WHERE id = ?",
      stale.id,
    );
    expect(
      raiseScopedMemoryFactSensitivityFloor({
        factId: stale.id,
        currentScope: currentScope(),
        sensitivityFloor: 'personal',
        now: 200,
      }),
    ).toMatchObject({ fact: { sensitivity: 'restricted' } });
    expect(factProjection(stale.id)).toMatchObject({
      sensitivity: 'restricted',
      sensitivity_policy_version: 1,
    });
  });

  it('repairs drifted applicability projections without changing explicit intent clocks', () => {
    const fact = seedFact();
    setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 200 });
    setScopedMemoryFactReviewState({
      factId: fact.id,
      currentScope: currentScope(),
      reviewState: 'verified',
      now: 210,
    });
    raiseScopedMemoryFactSensitivityFloor({
      factId: fact.id,
      currentScope: currentScope(),
      sensitivityFloor: 'personal',
      now: 220,
    });
    const canonicalBefore = overrideRow(fact.id);
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 0, review_state = 'auto', sensitivity = 'normal'
        WHERE id = ?`,
      fact.id,
    );
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 300 })).toMatchObject({
      status: 'unchanged',
      fact: { pinned: true },
    });
    expect(
      setScopedMemoryFactReviewState({
        factId: fact.id,
        currentScope: currentScope(),
        reviewState: 'verified',
        now: 310,
      }),
    ).toMatchObject({ status: 'unchanged', fact: { reviewState: 'verified' } });
    expect(
      raiseScopedMemoryFactSensitivityFloor({
        factId: fact.id,
        currentScope: currentScope(),
        sensitivityFloor: 'normal',
        now: 320,
      }),
    ).toMatchObject({ status: 'unchanged', fact: { sensitivity: 'personal' } });

    expect(overrideRow(fact.id)).toEqual(canonicalBefore);
    expect(factProjection(fact.id)).toMatchObject({
      pinned: 1,
      review_state: 'verified',
      sensitivity: 'personal',
    });
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('repairs stale sensitivity projections conservatively on an idempotent retry', () => {
    const fact = seedFact();
    raiseScopedMemoryFactSensitivityFloor({
      factId: fact.id,
      currentScope: currentScope(),
      sensitivityFloor: 'personal',
      now: 200,
    });
    const canonicalBefore = overrideRow(fact.id);
    getMemoryDb().runSync(
      "UPDATE memory_facts SET sensitivity = 'normal', sensitivity_policy_version = 1 WHERE id = ?",
      fact.id,
    );

    expect(
      raiseScopedMemoryFactSensitivityFloor({
        factId: fact.id,
        currentScope: currentScope(),
        sensitivityFloor: 'normal',
        now: 300,
      }),
    ).toMatchObject({ status: 'unchanged', fact: { sensitivity: 'restricted' } });
    expect(overrideRow(fact.id)).toEqual(canonicalBefore);
    expect(factProjection(fact.id)).toMatchObject({
      sensitivity: 'restricted',
      sensitivity_policy_version: 1,
    });
  });

  it('persists one idempotent manual invalidation and returns its original clock', () => {
    const fact = seedFact();
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(
      invalidateScopedMemoryFact({
        factId: fact.id,
        currentScope: currentScope(),
        now: 200,
      }),
    ).toMatchObject({ status: 'updated', invalidatedAt: 200, fact: { invalidAt: 200 } });
    expect(
      invalidateScopedMemoryFact({
        factId: fact.id,
        currentScope: currentScope(),
        now: 300,
      }),
    ).toMatchObject({ status: 'unchanged', invalidatedAt: 200 });
    expect(overrideRow(fact.id)).toMatchObject({ explicit_invalidated_at: 200 });
    expect(factProjection(fact.id)).toMatchObject({ invalid_at: 200, updated_at: 200 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('repairs a drifted invalidation projection without changing the explicit clock', () => {
    const fact = seedFact();
    invalidateManagedMemoryFact({ factId: fact.id, now: 200 });
    const canonicalBefore = overrideRow(fact.id);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = NULL, updated_at = 300 WHERE id = ?',
      fact.id,
    );
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(invalidateManagedMemoryFact({ factId: fact.id, now: 400 })).toMatchObject({
      status: 'unchanged',
      invalidatedAt: 200,
      fact: { invalidAt: 200, updatedAt: 300 },
    });
    expect(overrideRow(fact.id)).toEqual(canonicalBefore);
    expect(factProjection(fact.id)).toMatchObject({ invalid_at: 200, updated_at: 300 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('allows explicit invalidation of inactive facts while malformed clocks fail closed', () => {
    const expired = seedFact();
    getMemoryDb().runSync('UPDATE memory_facts SET expires_at = 150 WHERE id = ?', expired.id);
    expect(invalidateManagedMemoryFact({ factId: expired.id, now: 200 })).toMatchObject({
      status: 'updated',
      fact: { invalidAt: 200, expiresAt: 150 },
    });

    const futureValid = seedFact();
    getMemoryDb().runSync('UPDATE memory_facts SET valid_at = 300 WHERE id = ?', futureValid.id);
    expect(invalidateManagedMemoryFact({ factId: futureValid.id, now: 200 })).toMatchObject({
      status: 'updated',
      fact: { invalidAt: 200, validAt: 300 },
    });

    const malformed = seedFact();
    getMemoryDb().runSync('UPDATE memory_facts SET expires_at = -1 WHERE id = ?', malformed.id);
    expectMutationCode(
      () => setManagedMemoryFactPinned({ factId: malformed.id, pinned: true, now: 200 }),
      'inactive',
    );
    expectMutationCode(
      () => invalidateManagedMemoryFact({ factId: malformed.id, now: 200 }),
      'inactive',
    );
    expect(overrideRow(malformed.id)).toBeNull();
  });

  it('does not relabel a pre-existing system invalidation as explicit intent', () => {
    const fact = seedFact();
    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = 150, updated_at = 150 WHERE id = ?',
      fact.id,
    );

    expectMutationCode(
      () => invalidateManagedMemoryFact({ factId: fact.id, now: 200 }),
      'already_invalidated',
    );
    expect(overrideRow(fact.id)).toBeNull();
  });

  it('rolls back explicit intent and emits no notification when projection update fails', () => {
    const fact = seedFact();
    const db = getMemoryDb();
    const originalRunSync = db.runSync.bind(db);
    jest.spyOn(db, 'runSync').mockImplementation(((sql: string, ...params: unknown[]) => {
      if (sql.includes('UPDATE memory_facts SET pinned')) {
        throw new Error('injected_projection_failure');
      }
      return originalRunSync(sql, ...params);
    }) as typeof db.runSync);
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(() => setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 200 })).toThrow(
      'injected_projection_failure',
    );
    expect(overrideRow(fact.id)).toBeNull();
    expect(factProjection(fact.id)?.pinned).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('leaves the projection unchanged when canonical intent persistence fails', () => {
    const fact = seedFact();
    const db = getMemoryDb();
    const originalRunSync = db.runSync.bind(db);
    jest.spyOn(db, 'runSync').mockImplementation(((sql: string, ...params: unknown[]) => {
      if (sql.includes('INSERT INTO memory_fact_explicit_overrides')) {
        throw new Error('injected_override_failure');
      }
      return originalRunSync(sql, ...params);
    }) as typeof db.runSync);
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(() => setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 200 })).toThrow(
      'injected_override_failure',
    );
    expect(overrideRow(fact.id)).toBeNull();
    expect(factProjection(fact.id)?.pinned).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('rolls back canonical intent when manual invalidation projection fails', () => {
    const fact = seedFact();
    const db = getMemoryDb();
    const originalRunSync = db.runSync.bind(db);
    jest.spyOn(db, 'runSync').mockImplementation(((sql: string, ...params: unknown[]) => {
      if (sql.includes('UPDATE memory_facts SET invalid_at')) {
        throw new Error('injected_invalidation_failure');
      }
      return originalRunSync(sql, ...params);
    }) as typeof db.runSync);

    expect(() => invalidateManagedMemoryFact({ factId: fact.id, now: 200 })).toThrow(
      'injected_invalidation_failure',
    );
    expect(overrideRow(fact.id)).toBeNull();
    expect(factProjection(fact.id)?.invalid_at).toBeNull();
  });

  it('rejects unsafe or regressing clocks without changing intent', () => {
    const fact = seedFact();
    expectMutationCode(
      () =>
        setManagedMemoryFactPinned({ factId: fact.id, pinned: 1 as unknown as boolean, now: 200 }),
      'pinned_invalid',
    );
    expectMutationCode(
      () => setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: -1 }),
      'clock_invalid',
    );
    expectMutationCode(
      () => setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 99 }),
      'clock_regression',
    );
    setManagedMemoryFactPinned({ factId: fact.id, pinned: true, now: 200 });
    expectMutationCode(
      () => setManagedMemoryFactPinned({ factId: fact.id, pinned: false, now: 200 }),
      'clock_regression',
    );
    expect(overrideRow(fact.id)).toMatchObject({ pinned_override: 1, pinned_at: 200 });

    const malformed = seedFact();
    getMemoryDb().runSync('UPDATE memory_facts SET updated_at = 50 WHERE id = ?', malformed.id);
    expectMutationCode(
      () => setManagedMemoryFactPinned({ factId: malformed.id, pinned: true, now: 200 }),
      'inactive',
    );
  });

  it('overlays explicit review and sensitivity without mutating the sidecar', () => {
    const fact = seedFact();
    setScopedMemoryFactReviewState({
      factId: fact.id,
      currentScope: currentScope(),
      reviewState: 'verified',
      now: 200,
    });
    raiseScopedMemoryFactSensitivityFloor({
      factId: fact.id,
      currentScope: currentScope(),
      sensitivityFloor: 'sensitive',
      now: 210,
    });

    expect(
      overlayFactExplicitProjectionInTransaction({
        factId: fact.id,
        derivedPinned: false,
        derivedReviewState: 'rejected',
        derivedSensitivity: 'normal',
      }),
    ).toEqual({ pinned: false, reviewState: 'verified', sensitivity: 'sensitive' });
    expect(loadFactExplicitOverrideInTransaction(fact.id)).toMatchObject({
      reviewStateAt: 200,
      sensitivityFloorAt: 210,
      updatedAt: 210,
    });
  });
});
