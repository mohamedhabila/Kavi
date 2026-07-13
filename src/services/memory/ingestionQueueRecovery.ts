import { ensureFactSchema } from './schema';
import { getMemoryDb } from './database';
import { getRuntimeProcessEpoch } from '../runtimeProcessEpoch';
import { recoverIngestionJobClaim } from './ingestionQueueStore';

export interface StaleIngestionRecoveryResult {
  retrying: number;
  degraded: number;
  failed: number;
}

export function recoverStaleIngestionJobs(now = Date.now()): StaleIngestionRecoveryResult {
  ensureFactSchema();
  const currentProcessEpoch = getRuntimeProcessEpoch();
  const stale = getMemoryDb().getAllSync<{
    id: string;
    claim_token: string;
    claim_process_epoch: string;
    lease_expires_at: number;
  }>(
    `SELECT id, claim_token, claim_process_epoch, lease_expires_at
       FROM memory_ingestion_jobs
      WHERE status = 'processing'
        AND (claim_process_epoch != ? OR lease_expires_at <= ?)
      ORDER BY CASE WHEN claim_process_epoch != ? THEN 0 ELSE 1 END ASC,
               lease_expires_at ASC,
               created_at ASC`,
    currentProcessEpoch,
    now,
    currentProcessEpoch,
  );
  const result: StaleIngestionRecoveryResult = { retrying: 0, degraded: 0, failed: 0 };
  for (const row of stale) {
    const transition = recoverIngestionJobClaim({
      jobId: row.id,
      claimToken: row.claim_token,
      claimProcessEpoch: row.claim_process_epoch,
      leaseExpiresAt: row.lease_expires_at,
      now,
    });
    if (!transition.applied) continue;
    if (transition.status === 'retrying') result.retrying += 1;
    if (transition.status === 'degraded') result.degraded += 1;
    if (transition.status === 'failed') result.failed += 1;
  }
  return result;
}
