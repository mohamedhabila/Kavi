jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  dropFactExplicitOverrideFactReferenceTriggers,
  ensureFactExplicitOverrideSchema,
} from '../../../src/services/memory/factExplicitOverrideSchema';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { recordCodeOwnedTestFactWithContribution as recordFactWithContribution } from '../../helpers/factContributionWriteFixtures';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

interface OverrideValues {
  pinnedOverride?: number | null;
  pinnedAt?: number | null;
  reviewStateOverride?: string | null;
  reviewStateAt?: number | null;
  sensitivityFloor?: string | null;
  sensitivityFloorAt?: number | null;
  explicitInvalidatedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

type SqlValue = string | number | null;

let nextFact = 0;

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  nextFact = 0;
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  jest.restoreAllMocks();
});

function seedFact(): MemoryFact {
  nextFact += 1;
  const suffix = String(nextFact);
  const subject = upsertEntity({ type: 'self', name: 'user', now: 100 });
  return recordFactWithContribution(
    {
      subjectId: subject.id,
      predicate: `schema_override_${suffix}`,
      objectText: `value-${suffix}`,
      scope: 'global',
      sourceMessageId: `user-message-${suffix}`,
      sourceTurnId: `assistant-message-${suffix}`,
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    {
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      taskId: null,
      producer: {
        producerId: 'explicit_override_schema_test',
        producerEventId: `assistant-message-${suffix}:0`,
      },
      sourceAliases: [
        { sourceKind: 'message', sourceId: `user-message-${suffix}` },
        { sourceKind: 'turn', sourceId: `assistant-message-${suffix}` },
      ],
    },
  ).fact;
}

function seedUncontributedFact(): MemoryFact {
  nextFact += 1;
  const suffix = String(nextFact);
  const subject = upsertEntity({ type: 'self', name: 'user', now: 100 });
  return recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: `schema_override_uncontributed_${suffix}`,
      objectText: `value-uncontributed-${suffix}`,
      scope: 'global',
      sourceMessageId: `legacy-message-${suffix}`,
      sourceTurnId: `legacy-turn-${suffix}`,
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
}

function authorizeLegacyFactDeletion(factId: string): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_fact_legacy_quarantine(fact_id, reason, quarantined_at)
     VALUES (?, 'identity_invalid', 250)`,
    factId,
  );
}

function requireOwner(fact: MemoryFact): string {
  if (!fact.memoryOwnerId) throw new Error('test fact owner missing');
  return fact.memoryOwnerId;
}

function insertOverride(factId: string, memoryOwnerId: string, values: OverrideValues): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_fact_explicit_overrides(
       fact_id, memory_owner_id, pinned_override, pinned_at,
       review_state_override, review_state_at, sensitivity_floor,
       sensitivity_floor_at, explicit_invalidated_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    factId,
    memoryOwnerId,
    values.pinnedOverride ?? null,
    values.pinnedAt ?? null,
    values.reviewStateOverride ?? null,
    values.reviewStateAt ?? null,
    values.sensitivityFloor ?? null,
    values.sensitivityFloorAt ?? null,
    values.explicitInvalidatedAt ?? null,
    values.createdAt ?? 200,
    values.updatedAt ?? 200,
  );
}

function overrideCount(): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_fact_explicit_overrides',
    )?.count ?? 0
  );
}

function replaceFactRow(factId: string, overrides: Record<string, SqlValue> = {}): void {
  const db = getMemoryDb();
  const columns = db
    .getAllSync<{ name: string }>('PRAGMA table_info(memory_facts)')
    .map(({ name }) => name);
  const row = db.getFirstSync<Record<string, SqlValue>>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    factId,
  );
  if (!row) throw new Error('test fact missing');
  const values = columns.map((column) =>
    Object.prototype.hasOwnProperty.call(overrides, column) ? overrides[column]! : row[column]!,
  );
  db.runSync(
    `INSERT OR REPLACE INTO memory_facts(${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    ...values,
  );
}

function dropOverrideSchema(): void {
  const db = getMemoryDb();
  dropFactExplicitOverrideFactReferenceTriggers(db);
  db.execSync('DROP TABLE IF EXISTS memory_fact_explicit_overrides;');
}

function triggerNames(): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'trigger'
          AND name LIKE 'trg_memory_fact%explicit_override%'
        ORDER BY name`,
    )
    .map(({ name }) => name);
}

describe('fact explicit override schema', () => {
  it.each([
    ['requires at least one override', {}],
    ['requires the pinned clock', { pinnedOverride: 1 }],
    ['requires the pinned value', { pinnedAt: 200 }],
    ['rejects an invalid pin', { pinnedOverride: 2, pinnedAt: 200 }],
    ['rejects an invalid review state', { reviewStateOverride: 'trusted', reviewStateAt: 200 }],
    ['requires the review clock', { reviewStateOverride: 'verified' }],
    ['rejects an invalid sensitivity', { sensitivityFloor: 'private', sensitivityFloorAt: 200 }],
    ['requires the sensitivity value', { sensitivityFloorAt: 200 }],
    ['rejects a negative invalidation', { explicitInvalidatedAt: -1 }],
    ['rejects a fractional clock', { pinnedOverride: 1, pinnedAt: 200.5, updatedAt: 201 }],
    [
      'rejects a fractional review clock',
      { reviewStateOverride: 'verified', reviewStateAt: 200.5, updatedAt: 201 },
    ],
    [
      'rejects a fractional sensitivity clock',
      { sensitivityFloor: 'personal', sensitivityFloorAt: 200.5, updatedAt: 201 },
    ],
    ['rejects a fractional invalidation clock', { explicitInvalidatedAt: 200.5, updatedAt: 201 }],
    ['rejects a fractional creation clock', { pinnedOverride: 1, pinnedAt: 200, createdAt: 199.5 }],
    ['rejects a fractional update clock', { pinnedOverride: 1, pinnedAt: 200, updatedAt: 200.5 }],
    ['rejects a clock before creation', { pinnedOverride: 1, pinnedAt: 199 }],
    ['rejects a clock after update', { pinnedOverride: 1, pinnedAt: 201 }],
    ['rejects an update before creation', { pinnedOverride: 1, pinnedAt: 200, updatedAt: 199 }],
    [
      'rejects an oversized pinned clock',
      {
        pinnedOverride: 1,
        pinnedAt: Number.MAX_SAFE_INTEGER + 1,
        updatedAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      'rejects an oversized review clock',
      {
        reviewStateOverride: 'verified',
        reviewStateAt: Number.MAX_SAFE_INTEGER + 1,
        updatedAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      'rejects an oversized sensitivity clock',
      {
        sensitivityFloor: 'sensitive',
        sensitivityFloorAt: Number.MAX_SAFE_INTEGER + 1,
        updatedAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      'rejects an oversized invalidation clock',
      {
        explicitInvalidatedAt: Number.MAX_SAFE_INTEGER + 1,
        updatedAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      'rejects an oversized creation clock',
      {
        pinnedOverride: 1,
        pinnedAt: Number.MAX_SAFE_INTEGER,
        createdAt: Number.MAX_SAFE_INTEGER + 1,
        updatedAt: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
    [
      'rejects an oversized update clock',
      {
        pinnedOverride: 1,
        pinnedAt: 200,
        updatedAt: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
  ] as const)('%s', (_label, values) => {
    ensureFactSchema();
    const fact = seedFact();

    expect(() => insertOverride(fact.id, requireOwner(fact), values)).toThrow();
    expect(overrideCount()).toBe(0);
  });

  it('stores semantic invalidation time before a later logical ordering clock', () => {
    ensureFactSchema();
    const fact = seedFact();

    insertOverride(fact.id, requireOwner(fact), {
      explicitInvalidatedAt: 150,
      createdAt: 200,
      updatedAt: 250,
    });

    expect(
      getMemoryDb().getFirstSync<{
        explicit_invalidated_at: number;
        created_at: number;
        updated_at: number;
      }>(
        `SELECT explicit_invalidated_at, created_at, updated_at
           FROM memory_fact_explicit_overrides WHERE fact_id = ?`,
        fact.id,
      ),
    ).toEqual({ explicit_invalidated_at: 150, created_at: 200, updated_at: 250 });
  });

  it('enforces the live parent owner and immutable target identity', () => {
    ensureFactSchema();
    const fact = seedFact();
    const owner = requireOwner(fact);

    expect(() =>
      insertOverride('missing-fact', owner, { pinnedOverride: 1, pinnedAt: 200 }),
    ).toThrow('memory_fact_explicit_override_parent_invalid');
    expect(() =>
      insertOverride(fact.id, 'another-memory-owner', { pinnedOverride: 1, pinnedAt: 200 }),
    ).toThrow('memory_fact_explicit_override_parent_invalid');

    insertOverride(fact.id, owner, { pinnedOverride: 1, pinnedAt: 200 });
    expect(() =>
      insertOverride(fact.id, owner, { reviewStateOverride: 'verified', reviewStateAt: 200 }),
    ).toThrow('memory_fact_explicit_override_insert_immutable');
    expect(() =>
      getMemoryDb().runSync(
        `INSERT OR REPLACE INTO memory_fact_explicit_overrides
         SELECT * FROM memory_fact_explicit_overrides WHERE fact_id = ?`,
        fact.id,
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        'DELETE FROM memory_fact_explicit_overrides WHERE fact_id = ?',
        fact.id,
      ),
    ).toThrow('memory_fact_explicit_override_delete_immutable');
    expect(() => replaceFactRow(fact.id)).toThrow(
      'memory_fact_explicit_override_parent_insert_immutable',
    );
    expect(() => replaceFactRow(fact.id, { memory_owner_id: 'another-memory-owner' })).toThrow(
      'memory_fact_explicit_override_parent_insert_immutable',
    );
    expect(() => replaceFactRow(fact.id, { deleted_at: 300 })).toThrow(
      'memory_fact_explicit_override_parent_insert_immutable',
    );
    expect(() =>
      getMemoryDb().runSync(
        `UPDATE memory_fact_explicit_overrides
            SET memory_owner_id = 'another-memory-owner'
          WHERE fact_id = ?`,
        fact.id,
      ),
    ).toThrow('memory_fact_explicit_override_identity_immutable');
    expect(() =>
      getMemoryDb().runSync(
        `UPDATE memory_facts
            SET memory_owner_id = 'another-memory-owner'
          WHERE id = ?`,
        fact.id,
      ),
    ).toThrow('memory_fact_explicit_override_parent_identity_immutable');
    getMemoryDb().runSync(
      `UPDATE memory_fact_explicit_overrides
          SET pinned_override = 0, pinned_at = 250, updated_at = 250
        WHERE fact_id = ?`,
      fact.id,
    );
    expect(
      getMemoryDb().getFirstSync<{ memory_owner_id: string; pinned_override: number }>(
        `SELECT memory_owner_id, pinned_override
           FROM memory_fact_explicit_overrides WHERE fact_id = ?`,
        fact.id,
      ),
    ).toEqual({ memory_owner_id: owner, pinned_override: 0 });
    expect(() =>
      getMemoryDb().runSync(
        `UPDATE memory_fact_explicit_overrides
            SET pinned_override = 1, pinned_at = 250
          WHERE fact_id = ?`,
        fact.id,
      ),
    ).toThrow('memory_fact_explicit_override_pin_clock_invalid');
    expect(() =>
      getMemoryDb().runSync(
        `UPDATE memory_fact_explicit_overrides
            SET created_at = 201
          WHERE fact_id = ?`,
        fact.id,
      ),
    ).toThrow('memory_fact_explicit_override_clock_regression');
    expect(() =>
      getMemoryDb().runSync(
        `UPDATE memory_fact_explicit_overrides
            SET fact_id = 'another-fact'
          WHERE fact_id = ?`,
        fact.id,
      ),
    ).toThrow('memory_fact_explicit_override_identity_immutable');
  });

  it('enforces monotonic sensitivity and irreversible explicit invalidation', () => {
    ensureFactSchema();
    const fact = seedFact();
    insertOverride(fact.id, requireOwner(fact), {
      sensitivityFloor: 'sensitive',
      sensitivityFloorAt: 200,
      explicitInvalidatedAt: 200,
    });

    expect(() =>
      getMemoryDb().runSync(
        `UPDATE memory_fact_explicit_overrides
            SET sensitivity_floor = 'personal', sensitivity_floor_at = 250, updated_at = 250
          WHERE fact_id = ?`,
        fact.id,
      ),
    ).toThrow('memory_fact_explicit_override_sensitivity_floor_invalid');
    expect(() =>
      getMemoryDb().runSync(
        `UPDATE memory_fact_explicit_overrides
            SET explicit_invalidated_at = 250, updated_at = 250
          WHERE fact_id = ?`,
        fact.id,
      ),
    ).toThrow('memory_fact_explicit_override_invalidation_immutable');
  });

  it('starts the cutover empty instead of inferring intent from historical projections', () => {
    ensureFactSchema();
    const fact = seedFact();
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 1,
              review_state = 'rejected',
              sensitivity = 'restricted',
              invalid_at = 150,
              updated_at = 150
        WHERE id = ?`,
      fact.id,
    );
    dropOverrideSchema();

    resetFactSchemaCacheForTests();
    ensureFactSchema();

    expect(overrideCount()).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{
        pinned: number;
        review_state: string;
        sensitivity: string;
        invalid_at: number;
      }>(
        `SELECT pinned, review_state, sensitivity, invalid_at
           FROM memory_facts WHERE id = ?`,
        fact.id,
      ),
    ).toEqual({
      pinned: 1,
      review_state: 'rejected',
      sensitivity: 'restricted',
      invalid_at: 150,
    });
  });

  it('cleans overrides only on hard deletion and preserves soft-retired intent', () => {
    ensureFactSchema();
    const hardDeleted = seedUncontributedFact();
    const retired = seedFact();
    insertOverride(hardDeleted.id, requireOwner(hardDeleted), {
      pinnedOverride: 1,
      pinnedAt: 200,
    });
    insertOverride(retired.id, requireOwner(retired), {
      reviewStateOverride: 'rejected',
      reviewStateAt: 200,
    });

    authorizeLegacyFactDeletion(hardDeleted.id);
    getMemoryDb().runSync('DELETE FROM memory_facts WHERE id = ?', hardDeleted.id);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET deleted_at = 300, updated_at = 300 WHERE id = ?',
      retired.id,
    );

    expect(overrideCount()).toBe(1);
    expect(
      getMemoryDb().getFirstSync(
        'SELECT * FROM memory_fact_explicit_overrides WHERE fact_id = ?',
        retired.id,
      ),
    ).toMatchObject({
      fact_id: retired.id,
      memory_owner_id: requireOwner(retired),
      review_state_override: 'rejected',
      review_state_at: 200,
    });
    expect(() =>
      insertOverride(retired.id, requireOwner(retired), { pinnedOverride: 1, pinnedAt: 400 }),
    ).toThrow('memory_fact_explicit_override_insert_immutable');
  });

  it('clears override intent during structured reset without removing the schema', () => {
    ensureFactSchema();
    const fact = seedFact();
    insertOverride(fact.id, requireOwner(fact), { explicitInvalidatedAt: 200 });
    const admission = getMemoryDb().getFirstSync<{ completed_at: number }>(
      'SELECT completed_at FROM memory_fact_contribution_admission WHERE singleton = 1',
    );

    clearStructuredMemory();

    expect(overrideCount()).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ name: string }>(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'memory_fact_explicit_overrides'`,
      )?.name,
    ).toBe('memory_fact_explicit_overrides');
    expect(
      getMemoryDb().getFirstSync<{ completed_at: number }>(
        'SELECT completed_at FROM memory_fact_contribution_admission WHERE singleton = 1',
      ),
    ).toEqual(admission);
  });

  it('preserves overrides through canonical fact rebuild and recreates every trigger', () => {
    ensureFactSchema();
    const fact = seedFact();
    insertOverride(fact.id, requireOwner(fact), {
      pinnedOverride: 0,
      pinnedAt: 200,
      sensitivityFloor: 'sensitive',
      sensitivityFloorAt: 210,
      createdAt: 200,
      updatedAt: 210,
    });
    getMemoryDb().execSync('ALTER TABLE memory_facts ADD COLUMN task_id TEXT;');

    resetFactSchemaCacheForTests();
    ensureFactSchema();

    expect(
      getMemoryDb().getFirstSync(
        'SELECT * FROM memory_fact_explicit_overrides WHERE fact_id = ?',
        fact.id,
      ),
    ).toEqual({
      fact_id: fact.id,
      memory_owner_id: requireOwner(fact),
      pinned_override: 0,
      pinned_at: 200,
      review_state_override: null,
      review_state_at: null,
      sensitivity_floor: 'sensitive',
      sensitivity_floor_at: 210,
      explicit_invalidated_at: null,
      created_at: 200,
      updated_at: 210,
    });
    expect(triggerNames()).toEqual([
      'trg_memory_fact_delete_explicit_override',
      'trg_memory_fact_explicit_override_delete_immutable',
      'trg_memory_fact_explicit_override_insert_immutable',
      'trg_memory_fact_explicit_override_parent_identity_immutable',
      'trg_memory_fact_explicit_override_parent_insert',
      'trg_memory_fact_explicit_override_parent_insert_immutable',
      'trg_memory_fact_explicit_override_update_guard',
    ]);

    const disposable = seedUncontributedFact();
    insertOverride(disposable.id, requireOwner(disposable), {
      pinnedOverride: 1,
      pinnedAt: 300,
      createdAt: 300,
      updatedAt: 300,
    });
    authorizeLegacyFactDeletion(disposable.id);
    getMemoryDb().runSync('DELETE FROM memory_facts WHERE id = ?', disposable.id);
    expect(overrideCount()).toBe(1);
    expect(
      getMemoryDb().getFirstSync(
        'SELECT fact_id FROM memory_fact_explicit_overrides WHERE fact_id = ?',
        fact.id,
      ),
    ).toEqual({ fact_id: fact.id });
  });

  it('preserves explicit intent when the canonical fact is retired', () => {
    ensureFactSchema();
    const fact = seedFact();
    insertOverride(fact.id, requireOwner(fact), {
      pinnedOverride: 1,
      pinnedAt: 200,
      reviewStateOverride: 'pending_review',
      reviewStateAt: 210,
      createdAt: 200,
      updatedAt: 210,
    });

    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = ?, deleted_at = ? WHERE id = ?',
      220,
      220,
      fact.id,
    );

    expect(
      getMemoryDb().getFirstSync(
        'SELECT * FROM memory_fact_explicit_overrides WHERE fact_id = ?',
        fact.id,
      ),
    ).toMatchObject({
      fact_id: fact.id,
      memory_owner_id: requireOwner(fact),
      pinned_override: 1,
      pinned_at: 200,
      review_state_override: 'pending_review',
      review_state_at: 210,
    });
  });

  it('rolls back the complete schema unit when trigger installation fails', () => {
    ensureFactSchema();
    const fact = seedFact();
    const db = getMemoryDb();
    dropOverrideSchema();
    const originalExecSync = db.execSync.bind(db);
    jest.spyOn(db, 'execSync').mockImplementation(((statement: string) => {
      if (statement.includes('CREATE TABLE IF NOT EXISTS memory_fact_explicit_overrides')) {
        originalExecSync(statement);
        throw new Error('injected_explicit_override_schema_failure');
      }
      return originalExecSync(statement);
    }) as typeof db.execSync);

    expect(() => ensureFactExplicitOverrideSchema(db)).toThrow(
      'injected_explicit_override_schema_failure',
    );

    expect(
      db.getFirstSync(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'memory_fact_explicit_overrides'`,
      ),
    ).toBeNull();
    expect(triggerNames()).toEqual([]);
    expect(
      db.getFirstSync<{ id: string }>('SELECT id FROM memory_facts WHERE id = ?', fact.id),
    ).toEqual({ id: fact.id });
  });
});
