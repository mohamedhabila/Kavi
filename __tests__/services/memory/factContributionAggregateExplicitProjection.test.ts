jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import type { RawFactEvidenceRow } from '../../../src/services/memory/factContributionAggregateQueries';
import { loadVerifiedFactContributionAggregatesInTransaction } from '../../../src/services/memory/factContributionAggregateStore';
import { requireFactContributionExplicitProjection } from '../../../src/services/memory/factContributionExplicitProjection';
import { recordFactWithContribution } from '../../../src/services/memory/facts/mutations';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

interface CreatedContribution {
  contributionId: string;
  factId: string;
}

interface OverrideInput {
  pinnedOverride?: boolean | null;
  pinnedAt?: number | null;
  reviewStateOverride?: string | null;
  reviewStateAt?: number | null;
  sensitivityFloor?: string | null;
  sensitivityFloorAt?: number | null;
  explicitInvalidatedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  jest.restoreAllMocks();
});

function createContribution(): CreatedContribution {
  const subject = upsertEntity({ type: 'self', name: 'aggregate-override-user', now: 1 });
  const created = recordFactWithContribution(
    {
      subjectId: subject.id,
      predicate: 'aggregate_override_state',
      objectText: 'value',
      scope: 'global',
      sourceMessageId: 'aggregate-override-message',
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    {
      memoryConversationId: 'aggregate-override-conversation',
      sourceThreadId: 'aggregate-override-thread',
      taskId: null,
      producer: {
        producerId: 'aggregate_override_test',
        producerEventId: 'aggregate-override-event',
      },
      sourceAliases: [{ sourceKind: 'message', sourceId: 'aggregate-override-message' }],
    },
  );
  const contributionId = getMemoryDb().getFirstSync<{ id: string }>(
    'SELECT id FROM memory_fact_contributions WHERE fact_id = ? LIMIT 1',
    created.fact.id,
  )!.id;
  return { contributionId, factId: created.fact.id };
}

function insertOverride(factId: string, input: OverrideInput): void {
  const db = getMemoryDb();
  const ownerId = getLocalMemoryVaultOwnerId(db);
  db.runSync(
    `INSERT INTO memory_fact_explicit_overrides(
       fact_id, memory_owner_id, pinned_override, pinned_at,
       review_state_override, review_state_at, sensitivity_floor,
       sensitivity_floor_at, explicit_invalidated_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    factId,
    ownerId,
    input.pinnedOverride === undefined || input.pinnedOverride === null
      ? null
      : input.pinnedOverride
        ? 1
        : 0,
    input.pinnedAt ?? null,
    input.reviewStateOverride ?? null,
    input.reviewStateAt ?? null,
    input.sensitivityFloor ?? null,
    input.sensitivityFloorAt ?? null,
    input.explicitInvalidatedAt ?? null,
    input.createdAt ?? 200,
    input.updatedAt ?? 200,
  );
}

function load(created: CreatedContribution) {
  return loadVerifiedFactContributionAggregatesInTransaction(getMemoryDb(), [
    created.contributionId,
  ]).aggregates[0]!;
}

function disableOverrideChecks(): void {
  getMemoryDb().execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_update_guard;
    PRAGMA ignore_check_constraints = ON;
  `);
}

describe('verified aggregate explicit projection evidence', () => {
  it('represents an all-null left join as no explicit override without another query', () => {
    const created = createContribution();
    const db = getMemoryDb();
    const getAllSpy = jest.spyOn(db, 'getAllSync');

    expect(load(created).explicitProjection).toBeNull();
    expect(getAllSpy).toHaveBeenCalledTimes(6);
  });

  it('loads pin, review, sensitivity, and explicit invalidation as frozen durable intent', () => {
    const created = createContribution();
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 1, review_state = 'verified', sensitivity = 'sensitive',
              invalid_at = 500, updated_at = 500
        WHERE id = ?`,
      created.factId,
    );
    insertOverride(created.factId, {
      pinnedOverride: true,
      pinnedAt: 200,
      reviewStateOverride: 'verified',
      reviewStateAt: 300,
      sensitivityFloor: 'sensitive',
      sensitivityFloorAt: 400,
      explicitInvalidatedAt: 500,
      createdAt: 200,
      updatedAt: 500,
    });

    const explicit = load(created).explicitProjection;
    expect(explicit).toEqual({
      pinnedOverride: true,
      reviewStateOverride: 'verified',
      sensitivityFloor: 'sensitive',
      explicitInvalidatedAt: 500,
    });
    expect(Object.isFrozen(explicit)).toBe(true);
  });

  it.each([
    ['missing paired clock', 'pinned_at', null],
    ['invalid review enum', 'review_state_override', 'not_a_review_state'],
    ['regressed creation clock', 'created_at', 99],
  ] as const)('rejects a malformed override %s', (_label, column, value) => {
    const created = createContribution();
    getMemoryDb().runSync('UPDATE memory_facts SET pinned = 1 WHERE id = ?', created.factId);
    insertOverride(created.factId, {
      pinnedOverride: true,
      pinnedAt: 200,
      createdAt: 200,
      updatedAt: 200,
    });
    disableOverrideChecks();
    getMemoryDb().runSync(
      `UPDATE memory_fact_explicit_overrides SET ${column} = ? WHERE fact_id = ?`,
      value,
      created.factId,
    );

    expect(() => load(created)).toThrow('memory_fact_contribution_aggregate_integrity_invalid');
  });

  it('rejects a foreign owner even when the override fact id still joins', () => {
    const created = createContribution();
    getMemoryDb().runSync('UPDATE memory_facts SET pinned = 1 WHERE id = ?', created.factId);
    insertOverride(created.factId, { pinnedOverride: true, pinnedAt: 200 });
    disableOverrideChecks();
    getMemoryDb().runSync(
      `UPDATE memory_fact_explicit_overrides
          SET memory_owner_id = 'foreign_owner'
        WHERE fact_id = ?`,
      created.factId,
    );

    expect(() => load(created)).toThrow('memory_fact_contribution_aggregate_integrity_invalid');
  });

  it.each([
    ['foreign fact identity', 'foreign_fact'],
    ['missing joined fact identity', null],
  ] as const)('rejects a %s before aggregate publication', (_label, overrideFactId) => {
    const created = createContribution();
    const fact = load(created).factEvidence;
    const raw = {
      override_fact_id: overrideFactId,
      override_memory_owner_id: fact.memoryOwnerId,
      override_pinned_override: 1,
      override_pinned_at: 200,
      override_review_state_override: null,
      override_review_state_at: null,
      override_sensitivity_floor: null,
      override_sensitivity_floor_at: null,
      override_explicit_invalidated_at: null,
      override_created_at: 200,
      override_updated_at: 200,
    } as unknown as RawFactEvidenceRow;

    expect(() => requireFactContributionExplicitProjection(raw, fact)).toThrow(
      'memory_fact_contribution_aggregate_integrity_invalid',
    );
  });

  it.each([
    ['pin', 'pinned = 0'],
    ['review', "review_state = 'auto'"],
    ['sensitivity', "sensitivity = 'normal'"],
  ] as const)('rejects a materialized %s that contradicts explicit intent', (_label, mutation) => {
    const created = createContribution();
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 1, review_state = 'verified', sensitivity = 'sensitive'
        WHERE id = ?`,
      created.factId,
    );
    insertOverride(created.factId, {
      pinnedOverride: true,
      pinnedAt: 200,
      reviewStateOverride: 'verified',
      reviewStateAt: 200,
      sensitivityFloor: 'sensitive',
      sensitivityFloorAt: 200,
    });
    getMemoryDb().runSync(`UPDATE memory_facts SET ${mutation} WHERE id = ?`, created.factId);

    expect(() => load(created)).toThrow('memory_fact_contribution_aggregate_integrity_invalid');
  });

  it('rejects a materialized invalidation that diverges from explicit intent', () => {
    const created = createContribution();
    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = 250, updated_at = 250 WHERE id = ?',
      created.factId,
    );
    insertOverride(created.factId, {
      explicitInvalidatedAt: 250,
      createdAt: 250,
      updatedAt: 250,
    });
    expect(load(created).explicitProjection?.explicitInvalidatedAt).toBe(250);

    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = 251, updated_at = 251 WHERE id = ?',
      created.factId,
    );
    expect(() => load(created)).toThrow('memory_fact_contribution_aggregate_integrity_invalid');
  });
});
