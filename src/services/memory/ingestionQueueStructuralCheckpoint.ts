import { getMemoryDb } from './database';
import {
  hasSealedIngestionJobIdentity,
  ingestionIdentityFailureCode,
  rowToIngestionJob,
  type IngestionJobRow,
} from './ingestionQueueIdentity';
import { failIngestionJobForInvalidIdentity } from './ingestionQueueIdentityFailure';
import { CAN_CLAIM_STRUCTURAL_CHECKPOINT_SQL } from './ingestionQueueDependencies';
import type { IngestionJobStatus } from './ingestionQueueStore';
import { MAX_INGESTION_ATTEMPTS } from './onDeviceGuards';
import { newId } from './schema';
import { getRuntimeProcessEpoch } from '../runtimeProcessEpoch';

export const INGESTION_PROCESSING_LEASE_MS = 5 * 60_000;

export function claimIngestionJobForStructuralCheckpoint(
  jobId: string,
  now: number,
): string | null {
  const row = getMemoryDb().getFirstSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs WHERE id = ? LIMIT 1`,
    jobId,
  );
  if (!row) return null;
  const job = rowToIngestionJob(row);
  if (!hasSealedIngestionJobIdentity(job)) {
    failIngestionJobForInvalidIdentity(job.id, ingestionIdentityFailureCode(job), now);
    return null;
  }
  const claimToken = newId('ingestion_claim');
  const claimProcessEpoch = getRuntimeProcessEpoch();
  const result = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs AS candidate
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           provider_outcome = NULL,
           outcome_code = NULL,
           next_attempt_at = NULL,
           lease_expires_at = ?,
           claim_token = ?,
           claim_process_epoch = ?,
           completed_at = NULL,
           updated_at = ?
     WHERE candidate.id = ?
       AND candidate.status IN ('pending', 'retrying')
       AND candidate.next_attempt_at <= ?
       AND candidate.attempt_count < ?
       AND ${CAN_CLAIM_STRUCTURAL_CHECKPOINT_SQL}`,
    now + INGESTION_PROCESSING_LEASE_MS,
    claimToken,
    claimProcessEpoch,
    now,
    jobId,
    now,
    MAX_INGESTION_ATTEMPTS,
  );
  return result.changes === 1 ? claimToken : null;
}

export interface IngestionStructuralCheckpointTransition {
  status: IngestionJobStatus;
  applied: boolean;
}

export function deferIngestionEnrichmentAfterStructuralCheckpoint(input: {
  jobId: string;
  now: number;
  claimToken: string;
}): IngestionStructuralCheckpointTransition {
  const current = getMemoryDb().getFirstSync<{
    status: string;
    structural_completed_at: number | null;
    claim_token: string | null;
    claim_process_epoch: string | null;
    lease_expires_at: number | null;
  }>(
    `SELECT status, structural_completed_at, claim_token, claim_process_epoch, lease_expires_at
       FROM memory_ingestion_jobs
      WHERE id = ?
      LIMIT 1`,
    input.jobId,
  );
  if (
    !current ||
    current.status !== 'processing' ||
    current.claim_token !== input.claimToken ||
    current.claim_process_epoch !== getRuntimeProcessEpoch() ||
    (current.lease_expires_at ?? Number.NEGATIVE_INFINITY) <= input.now ||
    current.structural_completed_at === null
  ) {
    return {
      status: (current?.status as IngestionJobStatus | undefined) ?? 'failed',
      applied: false,
    };
  }

  const updated = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = 'retrying',
           attempt_count = MAX(0, attempt_count - 1),
           provider_outcome = 'structural_only',
           outcome_code = NULL,
           next_attempt_at = ?,
           lease_expires_at = NULL,
           claim_token = NULL,
           claim_process_epoch = NULL,
           completed_at = NULL,
           updated_at = ?
     WHERE id = ?
       AND status = 'processing'
       AND claim_token = ?
       AND claim_process_epoch = ?
       AND lease_expires_at > ?
       AND structural_completed_at IS NOT NULL`,
    input.now,
    input.now,
    input.jobId,
    input.claimToken,
    getRuntimeProcessEpoch(),
    input.now,
  );
  return { status: 'retrying', applied: updated.changes === 1 };
}
