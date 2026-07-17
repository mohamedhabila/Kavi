jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import {
  advanceMemoryProjectionInTransaction,
  advanceRestrictiveMemoryAuthorityInTransaction,
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
  setDurableMemoryPolicyEnabled,
} from '../../../src/services/memory/memoryAuthority';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  ensureMemoryVaultIdentitySchema,
  getLocalMemoryVaultOwnerId,
} from '../../../src/services/memory/memoryVaultIdentity';
import {
  clearStructuredMemoryDatabase,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  setDurableMemoryPolicyEnabled(true);
});

afterEach(() => {
  closeMemoryDb();
});

function requireSnapshot() {
  const snapshot = captureMemoryAuthoritySnapshot();
  if (!snapshot) throw new Error('expected memory authority snapshot');
  return snapshot;
}

describe('memory authority', () => {
  it('migrates an old vault row without replacing its owner identity', () => {
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_vault_identity (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        owner_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL CHECK(created_at >= 0)
      );
      INSERT INTO memory_vault_identity(singleton, owner_id, created_at)
      VALUES (1, 'vault-owner-before-authority', 1);
    `);

    ensureMemoryVaultIdentitySchema(db, 2);

    expect(getLocalMemoryVaultOwnerId(db)).toBe('vault-owner-before-authority');
    expect(
      db.getFirstSync(
        `SELECT restrictive_authority_revision, projection_revision,
                memory_policy_enabled, memory_policy_revision
           FROM memory_vault_identity WHERE singleton = 1`,
      ),
    ).toEqual({
      restrictive_authority_revision: 0,
      projection_revision: 0,
      memory_policy_enabled: 1,
      memory_policy_revision: 0,
    });
  });

  it('advances only projection freshness for additive memory after commit', () => {
    const before = requireSnapshot();
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);

    runMemoryTransaction(() => {
      advanceMemoryProjectionInTransaction(db, memoryOwnerId);
      expect(isMemoryProjectionSnapshotCurrent(before)).toBe(true);
      expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
    });

    const after = requireSnapshot();
    expect(isMemoryProjectionSnapshotCurrent(before)).toBe(false);
    expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(true);
    expect(after.projectionRevision.value).toBe(before.projectionRevision.value + 1);
    expect(after.restrictiveRevision.value).toBe(before.restrictiveRevision.value);
  });

  it('advances restrictive and projection authority atomically after commit', () => {
    const before = requireSnapshot();
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);

    runMemoryTransaction(() => {
      advanceRestrictiveMemoryAuthorityInTransaction(db, memoryOwnerId);
      expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
      expect(isMemoryProjectionSnapshotCurrent(before)).toBe(true);
    });

    const after = requireSnapshot();
    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(false);
    expect(isMemoryProjectionSnapshotCurrent(before)).toBe(false);
    expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(false);
    expect(after.restrictiveRevision.value).toBe(before.restrictiveRevision.value + 1);
    expect(after.projectionRevision.value).toBe(before.projectionRevision.value + 1);
  });

  it.each(['projection', 'restrictive'] as const)(
    'does not advance %s authority when the outer transaction rolls back',
    (kind) => {
      const before = requireSnapshot();
      const db = getMemoryDb();
      const memoryOwnerId = getLocalMemoryVaultOwnerId(db);

      expect(() =>
        runMemoryTransaction(() => {
          if (kind === 'projection') {
            advanceMemoryProjectionInTransaction(db, memoryOwnerId);
          } else {
            advanceRestrictiveMemoryAuthorityInTransaction(db, memoryOwnerId);
          }
          throw new Error('rollback');
        }),
      ).toThrow('rollback');

      expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
      expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(true);
      expect(isMemoryProjectionSnapshotCurrent(before)).toBe(true);
      expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(true);
    },
  );

  it('detects an external projection advance without revoking admitted work', () => {
    const before = requireSnapshot();
    getMemoryDb().runSync(
      `UPDATE memory_vault_identity
          SET projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    );

    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(true);
    expect(isMemoryProjectionSnapshotCurrent(before)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(false);
  });

  it('detects an external restrictive advance across both authority dimensions', () => {
    const before = requireSnapshot();
    getMemoryDb().runSync(
      `UPDATE memory_vault_identity
          SET restrictive_authority_revision = restrictive_authority_revision + 1,
              projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    );

    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(false);
    expect(isMemoryProjectionSnapshotCurrent(before)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(false);
  });

  it('persists opt-out authority across runtimes and creates a new opt-in generation', () => {
    const enabled = requireSnapshot();

    setDurableMemoryPolicyEnabled(false);

    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(enabled)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(enabled)).toBe(false);
    expect(isMemoryProjectionSnapshotCurrent(enabled)).toBe(false);
    expect(captureMemoryAuthoritySnapshot()).toBeNull();

    setDurableMemoryPolicyEnabled(true);
    const reenabled = requireSnapshot();
    expect(reenabled.policy.revision).toBe(enabled.policy.revision + 2);
    expect(reenabled.restrictiveRevision.value).toBe(enabled.restrictiveRevision.value + 2);
    expect(reenabled.projectionRevision.value).toBe(enabled.projectionRevision.value + 2);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(reenabled)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(reenabled)).toBe(true);
  });

  it('does not revoke process or durable policy authority when a transition rolls back', () => {
    const before = requireSnapshot();

    expect(() =>
      runMemoryTransaction(() => {
        setDurableMemoryPolicyEnabled(false);
        throw new Error('rollback-policy');
      }),
    ).toThrow('rollback-policy');

    expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(true);
    expect(isMemoryProjectionSnapshotCurrent(before)).toBe(true);
    expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(true);
  });

  it('preserves the vault identity while preventing reset ABA', () => {
    const before = requireSnapshot();
    const owner = before.restrictiveRevision.memoryOwnerId;

    clearStructuredMemoryDatabase(getMemoryDb());

    const after = requireSnapshot();
    expect(after.restrictiveRevision.memoryOwnerId).toBe(owner);
    expect(after.restrictiveRevision.value).toBe(before.restrictiveRevision.value + 1);
    expect(after.projectionRevision.value).toBe(before.projectionRevision.value + 1);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(false);
    expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(false);
  });

  it('returns a deeply immutable authority snapshot', () => {
    const snapshot = requireSnapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.processEpochs)).toBe(true);
    expect(Object.isFrozen(snapshot.restrictiveRevision)).toBe(true);
    expect(Object.isFrozen(snapshot.projectionRevision)).toBe(true);
    expect(Object.isFrozen(snapshot.policy)).toBe(true);
  });
});
