import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import type { getMemoryDb } from './database';
import {
  ensureMemoryVaultIdentitySchema,
  getLocalMemoryVaultOwnerId,
} from './memoryVaultIdentity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

function tableExists(db: MemoryDb, tableName: string): boolean {
  return Boolean(
    db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      tableName,
    ),
  );
}

/**
 * Canonical, monotonic replay fences for exact memory sources.
 *
 * The legacy source table was owned by a fact withdrawal, so the same source
 * could be recorded more than once and non-fact operations had no clean owner.
 * Retirement groups make the operation generic while the source tuple itself
 * remains globally idempotent inside the local memory vault.
 */
export function ensureSourceRetirementSchema(db: MemoryDb): void {
  ensureMemoryVaultIdentitySchema(db);
  runMemoryDatabaseSavepoint(db, (database) => {
    database.execSync(`
      CREATE TABLE IF NOT EXISTS memory_source_retirement_groups (
        id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        retired_at INTEGER NOT NULL CHECK(retired_at >= 0)
      );
      CREATE TABLE IF NOT EXISTS memory_retired_sources (
        retirement_group_id TEXT NOT NULL,
        memory_owner_id TEXT NOT NULL,
        memory_conversation_id TEXT NOT NULL,
        source_thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('message', 'turn', 'run')),
        source_id TEXT NOT NULL,
        PRIMARY KEY (
          memory_owner_id,
          memory_conversation_id,
          source_thread_id,
          task_id,
          source_kind,
          source_id
        )
      );
      CREATE INDEX IF NOT EXISTS idx_memory_retired_sources_group
        ON memory_retired_sources(retirement_group_id);
    `);

    if (!tableExists(database, 'memory_withdrawal_sources')) return;

    const memoryOwnerId = getLocalMemoryVaultOwnerId(database);
    if (tableExists(database, 'memory_withdrawals')) {
      database.execSync(`
        INSERT OR IGNORE INTO memory_source_retirement_groups(id, reason, retired_at)
        SELECT DISTINCT source.withdrawal_id, 'fact_withdrawal',
               COALESCE(withdrawal.withdrawn_at, 0)
          FROM memory_withdrawal_sources AS source
          LEFT JOIN memory_withdrawals AS withdrawal
            ON withdrawal.id = source.withdrawal_id;
      `);
    } else {
      database.execSync(`
        INSERT OR IGNORE INTO memory_source_retirement_groups(id, reason, retired_at)
        SELECT DISTINCT withdrawal_id, 'fact_withdrawal', 0
          FROM memory_withdrawal_sources;
      `);
    }
    database.runSync(
      `INSERT OR IGNORE INTO memory_retired_sources(
         retirement_group_id, memory_owner_id, memory_conversation_id,
         source_thread_id, task_id, source_kind, source_id
       )
       SELECT withdrawal_id, ?, memory_conversation_id, source_thread_id,
              task_id, source_kind, source_id
         FROM memory_withdrawal_sources`,
      memoryOwnerId,
    );
    database.execSync('DROP TABLE memory_withdrawal_sources');
  });
}
