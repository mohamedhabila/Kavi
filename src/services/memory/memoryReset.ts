import { getSchemaReadyMemoryDb, type MemoryDatabase } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { checkpointMemoryDatabaseAfterSensitiveDeletion } from './database';
import { clearEmbeddingCache, getEmbeddingCacheEntryCount } from './embeddings';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { purgeAllRetiredCausalPayloadsForOwnerInTransaction } from './retiredCausalPayloadPurge';
import { retireExactMemorySources } from './sourceRetirementCoordinator';
import { USER_RESET_CLEARED_STRUCTURED_MEMORY_TABLES } from './structuredMemoryTableRegistry';

const RESET_SOURCE_BATCH_SIZE = 256;

interface ActiveSourceRow {
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: PersistedExactMemorySourceIdentity['sourceKind'];
  source_id: string;
}

function loadActiveSourceBatch(
  db: MemoryDatabase,
  memoryOwnerId: string,
): PersistedExactMemorySourceIdentity[] {
  return db
    .getAllSync<ActiveSourceRow>(
      `SELECT DISTINCT
              source.memory_owner_id, source.memory_conversation_id,
              source.source_thread_id, source.task_id,
              source.source_kind, source.source_id
         FROM memory_fact_contribution_sources AS source
         JOIN memory_fact_contributions AS contribution
           ON contribution.id = source.contribution_id
         LEFT JOIN memory_retired_fact_contributions AS retired
           ON retired.contribution_id = contribution.id
        WHERE contribution.memory_owner_id = ?
          AND retired.contribution_id IS NULL
        ORDER BY source.memory_owner_id ASC,
                 source.memory_conversation_id ASC,
                 source.source_thread_id ASC,
                 source.task_id ASC,
                 source.source_kind ASC,
                 source.source_id ASC
        LIMIT ${RESET_SOURCE_BATCH_SIZE}`,
      memoryOwnerId,
    )
    .map((row) => ({
      memoryOwnerId: row.memory_owner_id,
      memoryConversationId: row.memory_conversation_id,
      sourceThreadId: row.source_thread_id,
      taskId: row.task_id,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
    }));
}

function retirementTimestamp(db: MemoryDatabase, memoryOwnerId: string): number {
  const latestContribution = db.getFirstSync<{ latest: number | null }>(
    `SELECT MAX(contribution.contributed_at) AS latest
       FROM memory_fact_contributions AS contribution
       LEFT JOIN memory_retired_fact_contributions AS retired
         ON retired.contribution_id = contribution.id
      WHERE contribution.memory_owner_id = ?
        AND retired.contribution_id IS NULL`,
    memoryOwnerId,
  )?.latest;
  return Math.max(Date.now(), latestContribution ?? 0);
}

function assertNoActiveCausalMemory(db: MemoryDatabase, memoryOwnerId: string): void {
  const contribution = db.getFirstSync<{ id: string }>(
    `SELECT contribution.id
       FROM memory_fact_contributions AS contribution
       LEFT JOIN memory_retired_fact_contributions AS retired
         ON retired.contribution_id = contribution.id
      WHERE contribution.memory_owner_id = ?
        AND retired.contribution_id IS NULL
      LIMIT 1`,
    memoryOwnerId,
  );
  if (contribution) throw new Error('memory_reset_active_contribution_residual');

  const fact = db.getFirstSync<{ id: string }>(
    `SELECT id FROM memory_facts
      WHERE invalid_at IS NULL AND deleted_at IS NULL
      LIMIT 1`,
  );
  if (fact) throw new Error('memory_reset_active_fact_residual');
}

function clearDerivedMemory(db: MemoryDatabase): void {
  for (const table of USER_RESET_CLEARED_STRUCTURED_MEMORY_TABLES) {
    db.runSync(`DELETE FROM ${table}`);
  }
  for (const table of USER_RESET_CLEARED_STRUCTURED_MEMORY_TABLES) {
    const count = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    )?.count;
    if (count !== 0) throw new Error('memory_reset_derived_state_residual');
  }
}

/** Retire every causal source while preserving immutable replay fences and receipts. */
export function resetCanonicalMemoryForManagement(): void {
  runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const retiredAt = retirementTimestamp(db, memoryOwnerId);
    let retirementOperationCount = 0;

    for (;;) {
      const requestedSources = loadActiveSourceBatch(db, memoryOwnerId);
      if (requestedSources.length === 0) break;
      const result = retireExactMemorySources({
        reason: 'memory_reset',
        requestedSources,
        retiredAt,
      });
      if (result.status !== 'retired' || result.retiredContributionCount < 1) {
        throw new Error('memory_reset_source_retirement_no_progress');
      }
      retirementOperationCount += 1;
    }

    assertNoActiveCausalMemory(db, memoryOwnerId);
    purgeAllRetiredCausalPayloadsForOwnerInTransaction(db, memoryOwnerId);
    runAfterMemoryTransactionCommit(checkpointMemoryDatabaseAfterSensitiveDeletion);
    clearDerivedMemory(db);
    clearEmbeddingCache();
    if (getEmbeddingCacheEntryCount() !== 0) {
      throw new Error('memory_reset_embedding_cache_residual');
    }
    if (retirementOperationCount === 0) {
      runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
    }
  });
}
