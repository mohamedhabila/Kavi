import type { getMemoryDb } from './database';
import { quarantineConflictingSourceDuplicates } from './ingestionQueueConflictQuarantine';
import {
  advanceRestrictiveMemoryAuthorityRevisions,
  invalidateRestrictiveMemoryAuthorityProcessEpoch,
} from './memoryAuthorityState';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

/** Seal one source turn to one durable identity and quarantine ambiguous projections atomically. */
export function ensureIngestionQueueSourceIdentity(db: MemoryDb): void {
  let promptProjectionChanged = false;
  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    promptProjectionChanged = quarantineConflictingSourceDuplicates(db);
    db.execSync(`
      DELETE FROM memory_ingestion_jobs
        WHERE rowid IN (
          SELECT rowid
            FROM (
              SELECT rowid,
                     ROW_NUMBER() OVER (
                       PARTITION BY thread_id, source_end_message_id
                       ORDER BY
                         CASE status
                           WHEN 'completed_enriched' THEN 7
                           WHEN 'completed_structural' THEN 6
                           WHEN 'degraded' THEN 5
                           WHEN 'retrying' THEN 4
                           WHEN 'processing' THEN 3
                           WHEN 'pending' THEN 2
                           ELSE 1
                         END DESC,
                         attempt_count DESC,
                         updated_at DESC,
                         rowid DESC
                     ) AS source_rank
                FROM memory_ingestion_jobs
            )
           WHERE source_rank > 1
        );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_source_turn
        ON memory_ingestion_jobs(thread_id, source_end_message_id);
      DELETE FROM memory_ingestion_receipts
        WHERE job_id NOT IN (SELECT id FROM memory_ingestion_jobs);
      DELETE FROM memory_ingestion_structural_receipts
        WHERE job_id NOT IN (SELECT id FROM memory_ingestion_jobs);
    `);
    if (promptProjectionChanged) {
      advanceRestrictiveMemoryAuthorityRevisions(db, getLocalMemoryVaultOwnerId(db));
    }
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
  if (promptProjectionChanged) invalidateRestrictiveMemoryAuthorityProcessEpoch();
}
