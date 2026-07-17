jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { admitLegacyFactContributions } from '../../../src/services/memory/factContributionAdmission';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../src/services/memory/memoryAuthority';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function requireAuthoritySnapshot() {
  const snapshot = captureMemoryAuthoritySnapshot();
  if (!snapshot) throw new Error('expected memory authority snapshot');
  return snapshot;
}

function reopenLegacyAdmissionBoundary(): void {
  getMemoryDb().execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_insert_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_delete_immutable;
    DELETE FROM memory_fact_contribution_admission;
  `);
}

function seedUnprovenLegacyFact(): string {
  const subject = upsertEntity({ name: 'пользователь', type: 'self', now: 100 });
  return recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'preferência',
      objectText: '通知は静かに',
      scope: 'global',
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact.id;
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
});

describe('legacy contribution admission authority', () => {
  it('advances restrictive and durable freshness only when admission quarantines a live fact', () => {
    const factId = seedUnprovenLegacyFact();
    reopenLegacyAdmissionBoundary();
    const beforeAdmission = requireAuthoritySnapshot();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      status: 'completed',
      admittedCount: 0,
      quarantinedCount: 1,
    });

    expect(
      getMemoryDb().getFirstSync('SELECT id FROM memory_facts WHERE id = ?', factId),
    ).toBeNull();
    expect(
      getMemoryDb().getFirstSync(
        `SELECT reason, quarantined_at
           FROM memory_fact_legacy_quarantine
          WHERE fact_id = ?`,
        factId,
      ),
    ).toEqual({ reason: 'source_missing', quarantined_at: 500 });
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeAdmission)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeAdmission)).toBe(false);
    expect(isMemoryProjectionSnapshotCurrent(beforeAdmission)).toBe(false);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeAdmission)).toBe(false);
  });

  it('does not advance authority when the admission boundary is already complete', () => {
    const beforeAdmission = requireAuthoritySnapshot();

    expect(admitLegacyFactContributions(getMemoryDb(), 500).status).toBe('already_completed');

    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeAdmission)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeAdmission)).toBe(true);
    expect(isMemoryProjectionSnapshotCurrent(beforeAdmission)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeAdmission)).toBe(true);
  });

  it('does not advance authority when quarantine only removes non-retrievable history', () => {
    const factId = seedUnprovenLegacyFact();
    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = 150, updated_at = 150 WHERE id = ?',
      factId,
    );
    getMemoryDb().runSync('DELETE FROM memory_fact_terms WHERE fact_id = ?', factId);
    reopenLegacyAdmissionBoundary();
    const beforeAdmission = requireAuthoritySnapshot();

    expect(admitLegacyFactContributions(getMemoryDb(), 500)).toMatchObject({
      status: 'completed',
      admittedCount: 0,
      quarantinedCount: 1,
    });

    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeAdmission)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeAdmission)).toBe(true);
    expect(isMemoryProjectionSnapshotCurrent(beforeAdmission)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeAdmission)).toBe(true);
  });

  it('rolls quarantine, marker, and authority revisions back with the outer transaction', () => {
    const factId = seedUnprovenLegacyFact();
    reopenLegacyAdmissionBoundary();
    const beforeAdmission = requireAuthoritySnapshot();

    expect(() =>
      runMemoryTransaction(() => {
        expect(admitLegacyFactContributions(getMemoryDb(), 500).quarantinedCount).toBe(1);
        expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeAdmission)).toBe(true);
        throw new Error('forced_admission_rollback');
      }),
    ).toThrow('forced_admission_rollback');

    expect(
      getMemoryDb().getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_facts WHERE id = ?',
        factId,
      )?.deleted_at,
    ).toBeNull();
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_admission',
      )?.count,
    ).toBe(0);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeAdmission)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeAdmission)).toBe(true);
    expect(isMemoryProjectionSnapshotCurrent(beforeAdmission)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeAdmission)).toBe(true);
  });
});
