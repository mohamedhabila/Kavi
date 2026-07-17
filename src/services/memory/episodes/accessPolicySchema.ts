import { getSchemaReadyMemoryDb, type MemoryDatabase } from '../access/schemaGuard';
import { assertMemoryTransactionActive } from '../access/transaction';
import { ensureMemoryVaultIdentitySchema } from '../memoryVaultIdentity';

const POLICY_DELETE_BATCH_SIZE = 200;

function requireTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('memory_vault_timestamp_invalid');
  }
  return value;
}

export function ensureEpisodeAccessPolicySchema(db: MemoryDatabase, now = Date.now()): void {
  const createdAt = requireTimestamp(now);
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_episode_access_policies (
      episode_id TEXT PRIMARY KEY,
      memory_owner_id TEXT NOT NULL,
      memory_conversation_id TEXT NOT NULL,
      source_thread_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      task_id TEXT,
      shareability TEXT NOT NULL
        CHECK(shareability IN ('thread_only', 'session_threads')),
      sensitivity TEXT NOT NULL
        CHECK(sensitivity IN ('normal', 'private', 'sensitive')),
      expires_at INTEGER CHECK(expires_at IS NULL OR expires_at >= 0),
      policy_version INTEGER NOT NULL CHECK(policy_version = 1),
      bound_at INTEGER NOT NULL CHECK(bound_at >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_episode_access_cross_thread
      ON memory_episode_access_policies(
        memory_owner_id,
        memory_conversation_id,
        persona_id,
        shareability,
        sensitivity,
        expires_at,
        source_thread_id,
        episode_id
      );
  `);
  ensureMemoryVaultIdentitySchema(db, createdAt);
}

export function deleteEpisodeAccessPolicies(
  db: MemoryDatabase,
  episodeIds: ReadonlyArray<string>,
): number {
  assertMemoryTransactionActive('episode_access_policy_delete_transaction_required');
  if (db !== getSchemaReadyMemoryDb()) {
    throw new Error('episode_access_policy_delete_database_mismatch');
  }
  let deleted = 0;
  for (let offset = 0; offset < episodeIds.length; offset += POLICY_DELETE_BATCH_SIZE) {
    const batch = episodeIds.slice(offset, offset + POLICY_DELETE_BATCH_SIZE);
    deleted +=
      db.runSync(
        `DELETE FROM memory_episode_access_policies
          WHERE episode_id IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      ).changes ?? 0;
  }
  return deleted;
}

export function clearEpisodeAccessPolicies(db: MemoryDatabase): void {
  assertMemoryTransactionActive('episode_access_policy_clear_transaction_required');
  if (db !== getSchemaReadyMemoryDb()) {
    throw new Error('episode_access_policy_clear_database_mismatch');
  }
  db.runSync('DELETE FROM memory_episode_access_policies');
}
