import { runMemoryTransaction } from './access/transaction';
import { getMemoryDb } from './database';
import { requireIngestionTimestamp } from './ingestionQueueIdentity';
import { ensureFactSchema } from './schema';

export type IngestionIdentityFailureCode = 'persona_scope_missing' | 'source_identity_invalid';

export function failIngestionJobForInvalidIdentity(
  jobId: string,
  outcomeCode: IngestionIdentityFailureCode,
  now: number,
): boolean {
  ensureFactSchema();
  const failedAt = requireIngestionTimestamp(now, 'memory_ingestion_clock_invalid');
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
    db.runSync('DELETE FROM memory_ingestion_structural_receipts WHERE job_id = ?', jobId);
    db.runSync('DELETE FROM memory_ingestion_receipts WHERE job_id = ?', jobId);
    const result = db.runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'failed',
              provider_outcome = NULL,
              outcome_code = ?,
              next_attempt_at = NULL,
              lease_expires_at = NULL,
              claim_token = NULL,
              claim_process_epoch = NULL,
              structural_completed_at = NULL,
              completed_at = ?,
              updated_at = ?
        WHERE id = ?
          AND status IN ('pending', 'processing', 'retrying')`,
      outcomeCode,
      failedAt,
      failedAt,
      jobId,
    );
    return (result.changes ?? 0) === 1;
  });
}
