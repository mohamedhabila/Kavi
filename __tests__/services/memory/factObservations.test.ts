jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  loadActiveMemoryFactConflictSignals,
  recordMemoryFactObservation,
  setMemoryFactReviewState,
} from '../../../src/services/memory/facts/observations';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import type { MemoryFactScope } from '../../../src/services/memory/facts/types';
import { getFactById } from '../../../src/services/memory/facts/queries';
import type { MemoryAccessScopeIdentity } from '../../../src/services/memory/memoryScopeIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { subscribeToMemoryChanges } from '../../../src/services/memory/changeNotifications';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function currentScope(
  overrides: Partial<MemoryAccessScopeIdentity> = {},
): MemoryAccessScopeIdentity {
  return {
    memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
    memoryConversationId: 'conversation-1',
    sourceThreadId: 'thread-1',
    personaId: 'default',
    taskId: 'task-1',
    ...overrides,
  };
}

function createSubjectiveFact(): string {
  return recordFactWithApplicability(
    {
      subjectId: 'entity-user',
      predicate: 'preferred_name',
      objectText: 'Mo',
      scope: 'conversation',
      originConversationId: 'conversation-1',
      originThreadId: 'thread-1',
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact.id;
}

function createObservationSource(sourceId: string, now: number): string {
  return recordFactWithApplicability(
    {
      subjectId: `entity-${sourceId}`,
      predicate: 'evidence_source',
      objectText: sourceId,
      scope: 'session',
      originConversationId: 'conversation-1',
      originThreadId: 'thread-1',
      originTaskId: 'task-1',
      sourceMessageId: sourceId,
      now,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact.id;
}

function createFactForScope(label: string, scope: MemoryFactScope): string {
  return recordFactWithApplicability(
    {
      subjectId: `entity-${label}`,
      predicate: 'scope_guard',
      objectText: label,
      scope,
      ...(scope === 'conversation' || scope === 'project' || scope === 'session'
        ? { originConversationId: 'conversation-1' }
        : {}),
      ...(scope === 'session' ? { originThreadId: 'thread-1', originTaskId: 'task-1' } : {}),
      now: 100,
    },
    {
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
      ...(scope === 'persona' ? { personaId: 'default' } : {}),
    },
  ).fact.id;
}

function conflictingObservation(factId: string) {
  return {
    factId,
    relation: 'conflicts' as const,
    factClass: 'subjective_user' as const,
    sourceAuthority: 'grounded_user' as const,
    sourceKind: 'user_message' as const,
    sourceId: 'message-2',
    sourceScope: currentScope(),
    observedAt: 190,
    createdAt: 200,
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  jest.restoreAllMocks();
});

describe('durable memory fact observations', () => {
  it('records an exact conflict idempotently and updates only derived target state', () => {
    const factId = createSubjectiveFact();

    const first = recordMemoryFactObservation(conflictingObservation(factId), 200);
    const replay = recordMemoryFactObservation(conflictingObservation(factId), 200);

    expect(first.status).toBe('created');
    expect(replay).toEqual({ observation: first.observation, status: 'duplicate' });
    expect(getFactById(factId)).toMatchObject({
      factClass: 'subjective_user',
      reviewState: 'auto',
      lastConflictedAt: 190,
    });
    expect(
      loadActiveMemoryFactConflictSignals({
        factIds: [factId],
        currentScope: currentScope(),
        asOf: 200,
      }),
    ).toEqual([
      expect.objectContaining({
        factId,
        relation: 'conflicts',
        factClass: 'subjective_user',
        sourceAuthority: 'grounded_user',
        sourceKind: 'user_message',
        sourceId: 'message-2',
        observedAt: 190,
      }),
    ]);
  });

  it('requires the observation class to equal the target persisted class', () => {
    const factId = createSubjectiveFact();

    expect(() =>
      recordMemoryFactObservation(
        { ...conflictingObservation(factId), factClass: 'objective' },
        200,
      ),
    ).toThrow('memory_fact_observation_class_mismatch');
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_observations',
      )?.count,
    ).toBe(0);
  });

  it('applies as-of time to both observation and insertion clocks for conflicts and supports', () => {
    const factId = createSubjectiveFact();
    recordMemoryFactObservation(conflictingObservation(factId), 200);

    expect(
      loadActiveMemoryFactConflictSignals({
        factIds: [factId],
        currentScope: currentScope(),
        asOf: 195,
      }),
    ).toEqual([]);
    expect(
      loadActiveMemoryFactConflictSignals({
        factIds: [factId],
        currentScope: currentScope(),
        asOf: 200,
      }),
    ).toEqual([expect.objectContaining({ factId, observedAt: 190 })]);

    recordMemoryFactObservation(
      {
        ...conflictingObservation(factId),
        relation: 'supports',
        sourceId: 'message-support-as-of',
        observedAt: 195,
        createdAt: 210,
      },
      210,
    );
    expect(
      loadActiveMemoryFactConflictSignals({
        factIds: [factId],
        currentScope: currentScope(),
        asOf: 205,
      }),
    ).toEqual([expect.objectContaining({ factId, observedAt: 190 })]);
    expect(
      loadActiveMemoryFactConflictSignals({
        factIds: [factId],
        currentScope: currentScope(),
        asOf: 210,
      }),
    ).toEqual([]);
  });

  it.each([
    ['relation', { relation: 'supports' }, 'memory_fact_observation_identity_conflict'],
    ['observed time', { observedAt: 191 }, 'memory_fact_observation_identity_conflict'],
    ['class', { factClass: 'objective' }, 'memory_fact_observation_class_mismatch'],
    [
      'authority',
      { sourceAuthority: 'tool_observed' },
      'memory_fact_observation_identity_conflict',
    ],
    [
      'scope',
      {
        sourceScope: {
          sourceThreadId: 'thread-2',
        },
      },
      'memory_fact_observation_identity_conflict',
    ],
  ])(
    'rejects a %s shift when an immutable source event is replayed',
    (_label, change, expectedError) => {
      const factId = createSubjectiveFact();
      const original = conflictingObservation(factId);
      recordMemoryFactObservation(original, 200);
      const changedScope =
        'sourceScope' in change
          ? currentScope(change.sourceScope as Partial<MemoryAccessScopeIdentity>)
          : original.sourceScope;

      expect(() =>
        recordMemoryFactObservation(
          { ...original, ...change, sourceScope: changedScope } as typeof original,
          200,
        ),
      ).toThrow(expectedError);
      expect(
        getMemoryDb().getFirstSync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM memory_fact_observations',
        )?.count,
      ).toBe(1);
    },
  );

  it('treats a later-clock retry as a duplicate and preserves insertion metadata', () => {
    const factId = createSubjectiveFact();
    const input = conflictingObservation(factId);
    delete (input as { createdAt?: number }).createdAt;

    const first = recordMemoryFactObservation(input, 200);
    const replay = recordMemoryFactObservation(input, 300);

    expect(first.status).toBe('created');
    expect(first.observation.createdAt).toBe(200);
    expect(replay).toEqual({ observation: first.observation, status: 'duplicate' });
  });

  it('fails closed on forged scope, mismatched authority, and unsafe time', () => {
    const factId = createSubjectiveFact();

    expect(() =>
      recordMemoryFactObservation(
        {
          ...conflictingObservation(factId),
          sourceScope: currentScope({ memoryConversationId: 'conversation-2' }),
        },
        200,
      ),
    ).toThrow('memory_fact_observation_target_invalid');
    expect(() =>
      recordMemoryFactObservation(
        {
          ...conflictingObservation(factId),
          sourceKind: 'tool_run',
          sourceAuthority: 'grounded_user',
        },
        200,
      ),
    ).toThrow('memory_fact_observation_authority_invalid');
    expect(() =>
      recordMemoryFactObservation({ ...conflictingObservation(factId), observedAt: 201 }, 200),
    ).toThrow('memory_fact_observation_time_order_invalid');
    expect(() => recordMemoryFactObservation(conflictingObservation(factId), 1.5)).toThrow(
      'memory_fact_observation_clock_invalid',
    );
  });

  it.each([
    ['global persona', 'global', 'persona_id', 'default'],
    ['global conversation', 'global', 'origin_conversation_id', 'conversation-1'],
    ['global thread', 'global', 'origin_thread_id', 'thread-1'],
    ['global task', 'global', 'origin_task_id', 'task-1'],
    ['persona conversation', 'persona', 'origin_conversation_id', 'conversation-1'],
    ['persona thread', 'persona', 'origin_thread_id', 'thread-1'],
    ['persona task', 'persona', 'origin_task_id', 'task-1'],
    ['conversation persona', 'conversation', 'persona_id', 'default'],
    ['conversation task', 'conversation', 'origin_task_id', 'task-1'],
    ['project persona', 'project', 'persona_id', 'default'],
    ['project task', 'project', 'origin_task_id', 'task-1'],
    ['session persona', 'session', 'persona_id', 'default'],
    ['session missing task', 'session', 'origin_task_id', null],
  ] as const)(
    'rejects malformed %s binding on record, load, and applicability update',
    (_label, scope, column, value) => {
      const factId = createFactForScope(`malformed-${scope}-${column}`, scope);
      recordMemoryFactObservation(conflictingObservation(factId), 200);
      getMemoryDb().runSync(`UPDATE memory_facts SET ${column} = ? WHERE id = ?`, value, factId);

      expect(() =>
        recordMemoryFactObservation(
          {
            ...conflictingObservation(factId),
            sourceId: `message-new-${scope}-${column}`,
          },
          200,
        ),
      ).toThrow('memory_fact_observation_target_invalid');
      expect(
        loadActiveMemoryFactConflictSignals({
          factIds: [factId],
          currentScope: currentScope(),
          asOf: 200,
        }),
      ).toEqual([]);
      expect(() =>
        setMemoryFactReviewState({
          factId,
          currentScope: currentScope(),
          reviewState: 'verified',
          now: 200,
        }),
      ).toThrow('memory_fact_applicability_scope_mismatch');
    },
  );

  it.each([
    ['negative created time', 'created_at', -1],
    ['negative valid time', 'valid_at', -1],
    ['fractional invalid time', 'invalid_at', 300.5],
    ['fractional expiry time', 'expires_at', 300.5],
  ] as const)(
    'rejects a target with %s after SQL filtering on record, load, and update',
    (_label, column, value) => {
      const factId = createSubjectiveFact();
      recordMemoryFactObservation(conflictingObservation(factId), 200);
      getMemoryDb().runSync(`UPDATE memory_facts SET ${column} = ? WHERE id = ?`, value, factId);

      expect(() =>
        recordMemoryFactObservation(
          { ...conflictingObservation(factId), sourceId: `message-new-${column}` },
          200,
        ),
      ).toThrow('memory_fact_observation_target_invalid');
      expect(
        loadActiveMemoryFactConflictSignals({
          factIds: [factId],
          currentScope: currentScope(),
          asOf: 200,
        }),
      ).toEqual([]);
      expect(() =>
        setMemoryFactReviewState({
          factId,
          currentScope: currentScope(),
          reviewState: 'verified',
          now: 200,
        }),
      ).toThrow('memory_fact_applicability_scope_mismatch');
    },
  );

  it('rejects an observation whose source was withdrawn in the exact scope', () => {
    const factId = createSubjectiveFact();
    getMemoryDb().runSync(
      `INSERT INTO memory_withdrawal_sources(
        withdrawal_id, memory_conversation_id, source_thread_id, task_id,
        source_kind, source_id
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      'withdrawal-1',
      'conversation-1',
      'thread-1',
      'task-1',
      'message',
      'message-2',
    );

    expect(() => recordMemoryFactObservation(conflictingObservation(factId), 200)).toThrow(
      'Memory persistence source withdrawn',
    );
  });

  it('rolls back the observation and emits no notification when target update fails', () => {
    const factId = createSubjectiveFact();
    const db = getMemoryDb();
    const originalRunSync = db.runSync.bind(db);
    jest.spyOn(db, 'runSync').mockImplementation(((statement: string, ...params: unknown[]) => {
      if (statement.includes('SET last_conflicted_at')) throw new Error('injected_update_failure');
      return originalRunSync(statement, ...params);
    }) as typeof db.runSync);
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    expect(() => recordMemoryFactObservation(conflictingObservation(factId), 200)).toThrow(
      'injected_update_failure',
    );

    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_observations',
      )?.count,
    ).toBe(0);
    expect(getFactById(factId)).toMatchObject({ reviewState: 'auto', lastConflictedAt: null });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('clears an older conflict after a newer supporting observation', () => {
    const factId = createSubjectiveFact();
    recordMemoryFactObservation(conflictingObservation(factId), 200);
    recordMemoryFactObservation(
      {
        ...conflictingObservation(factId),
        relation: 'supports',
        sourceId: 'message-3',
        observedAt: 210,
        createdAt: 220,
      },
      220,
    );

    expect(getFactById(factId)).toMatchObject({
      reviewState: 'auto',
      lastConfirmedAt: 210,
      lastConflictedAt: 190,
    });
    expect(
      loadActiveMemoryFactConflictSignals({
        factIds: [factId],
        currentScope: currentScope(),
        asOf: 200,
      }),
    ).toEqual([expect.objectContaining({ factId, observedAt: 190 })]);
    expect(
      loadActiveMemoryFactConflictSignals({
        factIds: [factId],
        currentScope: currentScope(),
        asOf: 220,
      }),
    ).toEqual([]);
  });

  it('fails closed when direct conflict reads receive inactive or malformed target facts', () => {
    const createObservedFact = (suffix: string) => {
      const factId = recordFactWithApplicability(
        {
          subjectId: `entity-${suffix}`,
          predicate: 'preference',
          objectText: suffix,
          scope: 'conversation',
          originConversationId: 'conversation-1',
          now: 100,
        },
        { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
      ).fact.id;
      recordMemoryFactObservation(
        { ...conflictingObservation(factId), sourceId: `message-${suffix}` },
        200,
      );
      return factId;
    };
    const future = createObservedFact('future');
    const expired = createObservedFact('expired');
    const deleted = createObservedFact('deleted');
    const malformed = createObservedFact('malformed');
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET created_at = 300, valid_at = 300
        WHERE id = ?`,
      future,
    );
    getMemoryDb().runSync('UPDATE memory_facts SET expires_at = 195 WHERE id = ?', expired);
    getMemoryDb().runSync('UPDATE memory_facts SET deleted_at = 195 WHERE id = ?', deleted);
    getMemoryDb().runSync("UPDATE memory_facts SET scope = 'malformed' WHERE id = ?", malformed);

    expect(
      loadActiveMemoryFactConflictSignals({
        factIds: [future, expired, deleted, malformed],
        currentScope: currentScope(),
        asOf: 200,
      }),
    ).toEqual([]);
  });

  it('recomputes multiple conflict timestamps as source evidence is withdrawn', () => {
    const factId = createSubjectiveFact();
    const olderSourceFactId = createObservationSource('message-2', 110);
    const newerSourceFactId = createObservationSource('message-3', 120);
    recordMemoryFactObservation(conflictingObservation(factId), 200);
    recordMemoryFactObservation(
      {
        ...conflictingObservation(factId),
        sourceId: 'message-3',
        observedAt: 195,
        createdAt: 205,
      },
      205,
    );
    expect(getFactById(factId)?.lastConflictedAt).toBe(195);

    expect(withdrawMemoryFact(newerSourceFactId, 300).status).toBe('withdrawn');
    expect(getFactById(factId)?.lastConflictedAt).toBe(190);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_observations WHERE fact_id = ?',
        factId,
      )?.count,
    ).toBe(1);

    expect(withdrawMemoryFact(olderSourceFactId, 310).status).toBe('withdrawn');
    expect(getFactById(factId)?.lastConflictedAt).toBeNull();
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_observations WHERE fact_id = ?',
        factId,
      )?.count,
    ).toBe(0);
  });

  it('clears a derived support timestamp when its source is withdrawn', () => {
    const factId = createSubjectiveFact();
    const sourceFactId = createObservationSource('message-support', 110);
    recordMemoryFactObservation(
      {
        ...conflictingObservation(factId),
        relation: 'supports',
        sourceId: 'message-support',
        observedAt: 190,
      },
      200,
    );
    expect(getFactById(factId)?.lastConfirmedAt).toBe(190);

    expect(withdrawMemoryFact(sourceFactId, 300).status).toBe('withdrawn');
    expect(getFactById(factId)?.lastConfirmedAt).toBeNull();
    expect(getFactById(factId)?.reviewState).toBe('auto');
  });

  it('rolls back observation deletion and derived state when withdrawal recompute fails', () => {
    const factId = createSubjectiveFact();
    const sourceFactId = createObservationSource('message-2', 110);
    recordMemoryFactObservation(conflictingObservation(factId), 200);
    const db = getMemoryDb();
    const originalRunSync = db.runSync.bind(db);
    jest.spyOn(db, 'runSync').mockImplementation(((statement: string, ...params: unknown[]) => {
      if (statement.includes('SET last_conflicted_at = (')) {
        throw new Error('injected_recompute_failure');
      }
      return originalRunSync(statement, ...params);
    }) as typeof db.runSync);

    expect(() => withdrawMemoryFact(sourceFactId, 300)).toThrow('injected_recompute_failure');

    expect(getFactById(sourceFactId)).not.toBeNull();
    expect(getFactById(factId)?.lastConflictedAt).toBe(190);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_observations WHERE fact_id = ?',
        factId,
      )?.count,
    ).toBe(1);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_withdrawals',
      )?.count,
    ).toBe(0);
  });
});
