jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  backfillFactSensitivityPolicy,
  getFactSensitivityDiagnostics,
  maintainFactSensitivityPolicy,
} from '../../../src/services/memory/factSensitivityBackfill';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { getFactById } from '../../../src/services/memory/facts/queries';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import { MEMORY_FACT_SENSITIVITY_POLICY_VERSION } from '../../../src/services/memory/memorySensitivityPolicy';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../src/services/memory/memoryAuthority';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

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

function createFact(input: {
  predicate: string;
  objectText: string;
  now: number;
  sourceSummary?: string;
  attributes?: Record<string, unknown>;
  subjectId?: string;
}) {
  const subjectId =
    input.subjectId ?? upsertEntity({ name: 'user', type: 'self', now: input.now }).id;
  return recordFact({
    subjectId,
    predicate: input.predicate,
    objectText: input.objectText,
    sourceSummary: input.sourceSummary,
    attributes: input.attributes,
    scope: 'global',
    now: input.now,
  }).fact;
}

function makeLegacy(factId: string, sensitivity = 'normal'): void {
  getMemoryDb().runSync(
    `UPDATE memory_facts
        SET sensitivity = ?, sensitivity_policy_version = 0
      WHERE id = ?`,
    sensitivity,
    factId,
  );
}

function rawPolicy(factId: string): {
  sensitivity: string;
  sensitivity_policy_version: number;
  updated_at: number;
} {
  return getMemoryDb().getFirstSync(
    `SELECT sensitivity, sensitivity_policy_version, updated_at
       FROM memory_facts
      WHERE id = ?`,
    factId,
  )!;
}

describe('fact sensitivity policy migration', () => {
  it('writes new facts with the current policy version', () => {
    const fact = createFact({ predicate: 'preferred_theme', objectText: 'dark', now: 10 });

    expect(rawPolicy(fact.id)).toEqual({
      sensitivity: 'normal',
      sensitivity_policy_version: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
      updated_at: 10,
    });
    expect(getFactById(fact.id)?.sensitivity).toBe('normal');
  });

  it('reads a legacy normal row as restricted before backfill', () => {
    const fact = createFact({ predicate: 'preferred_theme', objectText: 'dark', now: 10 });
    makeLegacy(fact.id);

    expect(rawPolicy(fact.id).sensitivity).toBe('normal');
    expect(getFactById(fact.id)?.sensitivity).toBe('restricted');
  });

  it('seals an unproven pre-v3 row with a restricted migration floor', () => {
    const fact = createFact({
      predicate: 'حقل',
      objectText: 'قيمة',
      now: 10,
    });
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET sensitivity = 'normal', sensitivity_policy_version = 1
        WHERE id = ?`,
      fact.id,
    );

    expect(getFactById(fact.id)?.sensitivity).toBe('restricted');
    const beforeBackfill = captureMemoryAuthoritySnapshot();
    if (!beforeBackfill) throw new Error('expected memory authority');
    expect(backfillFactSensitivityPolicy()).toMatchObject({
      processedCount: 1,
      pendingCount: 0,
      policyVersion: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    });
    expect(rawPolicy(fact.id)).toEqual({
      sensitivity: 'restricted',
      sensitivity_policy_version: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
      updated_at: 10,
    });
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeBackfill)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeBackfill)).toBe(true);
  });

  it('does not infer migration authority from prose or attribute field names', () => {
    const fromSummary = createFact({
      predicate: '状態',
      objectText: '値',
      sourceSummary: 'ملخص',
      now: 10,
    });
    const fromAttributes = createFact({
      predicate: '属性',
      objectText: '別の値',
      attributes: { 任意: 'قيمة' },
      now: 20,
    });
    makeLegacy(fromSummary.id);
    makeLegacy(fromAttributes.id);

    expect(backfillFactSensitivityPolicy()).toEqual({
      processedCount: 2,
      pendingCount: 0,
      hasMore: false,
      policyVersion: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    });
    expect(rawPolicy(fromSummary.id)).toEqual({
      sensitivity: 'restricted',
      sensitivity_policy_version: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
      updated_at: 10,
    });
    expect(rawPolicy(fromAttributes.id)).toEqual({
      sensitivity: 'restricted',
      sensitivity_policy_version: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
      updated_at: 20,
    });
  });

  it('never lowers a valid persisted sensitivity and restricts invalid values', () => {
    const restricted = createFact({ predicate: 'preferred_theme', objectText: 'dark', now: 10 });
    const invalid = createFact({ predicate: 'preferred_editor', objectText: 'Kakoune', now: 20 });
    makeLegacy(restricted.id, 'restricted');
    makeLegacy(invalid.id, 'provider_clearance');

    expect(backfillFactSensitivityPolicy()).toMatchObject({
      processedCount: 2,
      pendingCount: 0,
    });
    expect(rawPolicy(restricted.id).sensitivity).toBe('restricted');
    expect(rawPolicy(invalid.id).sensitivity).toBe('restricted');
  });

  it('resumes in default-sized batches and is idempotent', () => {
    for (let index = 0; index < 18; index += 1) {
      const fact = createFact({
        predicate: `preference_${index}`,
        objectText: `value ${index}`,
        now: 100 + index,
      });
      makeLegacy(fact.id);
    }

    expect(getFactSensitivityDiagnostics()).toMatchObject({
      localFactCount: 18,
      currentPolicyFactCount: 0,
      pendingPolicyFactCount: 18,
      quarantinedFactCount: 0,
    });
    expect(backfillFactSensitivityPolicy()).toMatchObject({
      processedCount: 16,
      pendingCount: 2,
      hasMore: true,
    });
    expect(backfillFactSensitivityPolicy()).toMatchObject({
      processedCount: 2,
      pendingCount: 0,
      hasMore: false,
    });
    expect(backfillFactSensitivityPolicy()).toMatchObject({
      processedCount: 0,
      pendingCount: 0,
      hasMore: false,
    });
  });

  it('caps an oversized requested batch at 64 rows', () => {
    for (let index = 0; index < 65; index += 1) {
      const fact = createFact({
        predicate: `bounded_preference_${index}`,
        objectText: `value ${index}`,
        now: 100 + index,
      });
      makeLegacy(fact.id);
    }

    expect(backfillFactSensitivityPolicy({ limit: 1_000 })).toMatchObject({
      processedCount: 64,
      pendingCount: 1,
      hasMore: true,
    });
  });

  it('rolls back the full batch when any row update fails', () => {
    const first = createFact({ predicate: 'first_preference', objectText: 'one', now: 10 });
    const second = createFact({ predicate: 'second_preference', objectText: 'two', now: 20 });
    makeLegacy(first.id);
    makeLegacy(second.id);
    getMemoryDb().execSync(`
      CREATE TRIGGER fail_sensitivity_backfill
      BEFORE UPDATE OF sensitivity_policy_version ON memory_facts
      WHEN OLD.id = '${second.id}'
      BEGIN
        SELECT RAISE(ABORT, 'forced sensitivity migration failure');
      END;
    `);
    const beforeBackfill = captureMemoryAuthoritySnapshot();
    if (!beforeBackfill) throw new Error('expected memory authority');

    expect(() => backfillFactSensitivityPolicy()).toThrow('forced sensitivity migration failure');
    expect(rawPolicy(first.id).sensitivity_policy_version).toBe(0);
    expect(rawPolicy(second.id).sensitivity_policy_version).toBe(0);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeBackfill)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeBackfill)).toBe(true);
  });

  it('processes uncertain local data as restricted but never adopts unowned or foreign rows', () => {
    const uncertain = createFact({
      predicate: 'opaque_detail',
      objectText: 'opaque value',
      subjectId: 'missing-entity',
      now: 10,
    });
    const unowned = createFact({ predicate: 'unowned_preference', objectText: 'brief', now: 20 });
    const foreign = createFact({ predicate: 'foreign_preference', objectText: 'warm', now: 30 });
    makeLegacy(uncertain.id);
    makeLegacy(unowned.id);
    makeLegacy(foreign.id);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET memory_owner_id = NULL WHERE id = ?',
      unowned.id,
    );
    getMemoryDb().runSync(
      'UPDATE memory_facts SET memory_owner_id = ? WHERE id = ?',
      'foreign-owner',
      foreign.id,
    );

    expect(backfillFactSensitivityPolicy()).toMatchObject({
      processedCount: 1,
      pendingCount: 0,
    });
    expect(rawPolicy(uncertain.id)).toMatchObject({
      sensitivity: 'restricted',
      sensitivity_policy_version: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    });
    expect(rawPolicy(unowned.id).sensitivity_policy_version).toBe(0);
    expect(rawPolicy(foreign.id).sensitivity_policy_version).toBe(0);
    expect(getFactById(unowned.id)?.sensitivity).toBe('restricted');
    expect(getFactSensitivityDiagnostics().quarantinedFactCount).toBe(2);
    expect(getLocalMemoryVaultOwnerId(getMemoryDb())).not.toBe('foreign-owner');
  });

  it('rejects invalid batch boundaries', () => {
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => backfillFactSensitivityPolicy({ limit })).toThrow(
        'memory_fact_sensitivity_backfill_limit_invalid',
      );
    }
  });

  it('fails maintenance softly and leaves callers operational', () => {
    getMemoryDb().execSync('DROP TABLE memory_facts');

    expect(maintainFactSensitivityPolicy()).toBeNull();
  });
});
