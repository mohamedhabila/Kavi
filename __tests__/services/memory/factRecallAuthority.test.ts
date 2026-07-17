jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { markFactsRecalled } from '../../../src/services/memory/facts/factAccessMutations';
import { recordFact } from '../../../src/services/memory/facts/mutations';
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

function seedFact(): string {
  const subject = upsertEntity({ name: 'utilisateur', type: 'self', now: 100 });
  return recordFact({
    subjectId: subject.id,
    predicate: 'préférence',
    objectText: 'إشعارات هادئة',
    scope: 'global',
    now: 100,
  }).fact.id;
}

function readRecallState(factId: string) {
  return getMemoryDb().getFirstSync<{
    access_count: number;
    last_recalled_at: number | null;
    last_accessed_at: number | null;
  }>(
    `SELECT access_count, last_recalled_at, last_accessed_at
       FROM memory_facts
      WHERE id = ?`,
    factId,
  );
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

describe('fact recall authority', () => {
  it('invalidates same-runtime and durable projection freshness without revoking admitted work', () => {
    const factId = seedFact();
    const beforeRecall = requireAuthoritySnapshot();

    const result = markFactsRecalled([factId, factId], 200, {
      expectedAuthoritySnapshot: beforeRecall,
    });

    expect(result).toMatchObject({ status: 'updated', changedCount: 1 });
    expect(result.authorityContinuation).not.toBeNull();

    expect(readRecallState(factId)).toEqual({
      access_count: 1,
      last_recalled_at: 200,
      last_accessed_at: 200,
    });
    expect(isMemoryProjectionSnapshotCurrent(beforeRecall)).toBe(false);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeRecall)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeRecall)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeRecall)).toBe(true);
    expect(isMemoryProjectionSnapshotCurrent(result.authorityContinuation!)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(result.authorityContinuation!)).toBe(true);
  });

  it('does not advance authority when no current local fact matches', () => {
    const beforeRecall = requireAuthoritySnapshot();

    expect(markFactsRecalled(['missing-fact'], 200)).toEqual({
      status: 'unchanged',
      changedCount: 0,
      authorityContinuation: null,
    });
    expect(markFactsRecalled([], 200)).toEqual({
      status: 'unchanged',
      changedCount: 0,
      authorityContinuation: null,
    });

    expect(isMemoryProjectionSnapshotCurrent(beforeRecall)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeRecall)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeRecall)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeRecall)).toBe(true);
  });

  it('rolls recall telemetry and projection authority back together', () => {
    const factId = seedFact();
    const beforeRecall = requireAuthoritySnapshot();
    const stateBefore = readRecallState(factId);

    expect(() =>
      runMemoryTransaction(() => {
        expect(markFactsRecalled([factId], 200)).toEqual({
          status: 'updated',
          changedCount: 1,
          authorityContinuation: null,
        });
        expect(isMemoryProjectionSnapshotCurrent(beforeRecall)).toBe(true);
        throw new Error('forced_recall_rollback');
      }),
    ).toThrow('forced_recall_rollback');

    expect(readRecallState(factId)).toEqual(stateBefore);
    expect(isMemoryProjectionSnapshotCurrent(beforeRecall)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeRecall)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(beforeRecall)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeRecall)).toBe(true);
  });

  it('does not launder a cross-runtime projection change into a recall continuation', () => {
    const factId = seedFact();
    const beforeRecall = requireAuthoritySnapshot();
    const stateBefore = readRecallState(factId);
    getMemoryDb().runSync(
      `UPDATE memory_vault_identity
          SET projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    );

    expect(markFactsRecalled([factId], 200, { expectedAuthoritySnapshot: beforeRecall })).toEqual({
      status: 'authority_stale',
      changedCount: 0,
      authorityContinuation: null,
    });

    expect(readRecallState(factId)).toEqual(stateBefore);
    expect(isMemoryProjectionSnapshotCurrent(beforeRecall)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeRecall)).toBe(false);
  });
});
