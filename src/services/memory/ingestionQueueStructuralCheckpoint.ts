import { getMemoryDb } from './database';
import { runMemoryTransaction } from './access/transaction';
import {
  hasSealedIngestionJobIdentity,
  ingestionIdentityFailureCode,
  rowToIngestionJob,
  type IngestionJobRow,
} from './ingestionQueueIdentity';
import { failIngestionJobForInvalidIdentity } from './ingestionQueueIdentityFailure';
import {
  CAN_CLAIM_STRUCTURAL_CHECKPOINT_SQL,
  NO_ACTIVE_PRIOR_DEPENDENCY_SQL,
} from './ingestionQueueDependencies';
import type { IngestionJob, IngestionJobStatus } from './ingestionQueueStore';
import { MAX_INGESTION_ATTEMPTS } from './onDeviceGuards';
import { newId } from './schemaValues';
import { getRuntimeProcessEpoch } from '../runtimeProcessEpoch';
import { loadActiveIngestionSourceSnapshotForRow } from './ingestionSourceSnapshotStore';
import type { IngestionSourceSnapshotV1 } from './ingestionSourceSnapshot';

export const INGESTION_PROCESSING_LEASE_MS = 5 * 60_000;

export interface ClaimedIngestionSourceSnapshot {
  job: IngestionJob & { personaId: string };
  claimToken: string;
  sourceSnapshot: IngestionSourceSnapshotV1;
  mode: 'full' | 'structural_checkpoint';
}

type IngestionClaimPolicy = 'full_only' | 'structural_only' | 'full_or_structural';
type ClaimEligibilityRow = IngestionJobRow & {
  can_full_claim: number;
  can_structural_checkpoint: number;
};

function selectClaimMode(
  row: ClaimEligibilityRow,
  policy: IngestionClaimPolicy,
): ClaimedIngestionSourceSnapshot['mode'] | null {
  if (policy !== 'structural_only' && row.can_full_claim === 1) return 'full';
  if (policy !== 'full_only' && row.can_structural_checkpoint === 1) {
    return 'structural_checkpoint';
  }
  return null;
}

function claimIngestionSourceSnapshot(
  jobId: string,
  now: number,
  policy: IngestionClaimPolicy,
): ClaimedIngestionSourceSnapshot | null {
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
    const row = db.getFirstSync<ClaimEligibilityRow>(
      `SELECT candidate.*,
              CASE WHEN ${NO_ACTIVE_PRIOR_DEPENDENCY_SQL} THEN 1 ELSE 0 END
                AS can_full_claim,
              CASE WHEN ${CAN_CLAIM_STRUCTURAL_CHECKPOINT_SQL} THEN 1 ELSE 0 END
                AS can_structural_checkpoint
         FROM memory_ingestion_jobs AS candidate
        WHERE candidate.id = ?
        LIMIT 1`,
      jobId,
    );
    if (!row) return null;
    const job = rowToIngestionJob(row);
    if (!hasSealedIngestionJobIdentity(job)) {
      failIngestionJobForInvalidIdentity(job.id, ingestionIdentityFailureCode(job), now);
      return null;
    }
    let sourceSnapshot: IngestionSourceSnapshotV1 | null = null;
    if (
      policy !== 'full_or_structural' &&
      (row.status === 'pending' || row.status === 'processing' || row.status === 'retrying')
    ) {
      sourceSnapshot = loadActiveIngestionSourceSnapshotForRow(row, now);
      if (!sourceSnapshot) return null;
    }
    if (
      (row.status !== 'pending' && row.status !== 'retrying') ||
      row.next_attempt_at === null ||
      row.next_attempt_at > now ||
      row.attempt_count >= MAX_INGESTION_ATTEMPTS
    ) {
      return null;
    }
    const mode = selectClaimMode(row, policy);
    if (!mode) return null;
    sourceSnapshot ??= loadActiveIngestionSourceSnapshotForRow(row, now);
    if (!sourceSnapshot) return null;

    const claimToken = newId('ingestion_claim');
    const claimProcessEpoch = getRuntimeProcessEpoch();
    const dependencyPredicate =
      mode === 'full'
        ? NO_ACTIVE_PRIOR_DEPENDENCY_SQL
        : CAN_CLAIM_STRUCTURAL_CHECKPOINT_SQL;
    const result = db.runSync(
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
         AND ${dependencyPredicate}`,
      now + INGESTION_PROCESSING_LEASE_MS,
      claimToken,
      claimProcessEpoch,
      now,
      jobId,
      now,
      MAX_INGESTION_ATTEMPTS,
    );
    return result.changes === 1
      ? { job, claimToken, sourceSnapshot, mode }
      : null;
  });
}

/** Atomically validate, claim, and decode one due ingestion source exactly once. */
export function claimIngestionJobWithSourceSnapshot(
  jobId: string,
  now: number,
): ClaimedIngestionSourceSnapshot | null {
  return claimIngestionSourceSnapshot(jobId, now, 'full_or_structural');
}

export function claimIngestionJobForFullProcessing(
  jobId: string,
  now: number,
): ClaimedIngestionSourceSnapshot | null {
  return claimIngestionSourceSnapshot(jobId, now, 'full_only');
}

export function claimIngestionJobForStructuralCheckpoint(
  jobId: string,
  now: number,
): string | null {
  return claimIngestionSourceSnapshot(jobId, now, 'structural_only')?.claimToken ?? null;
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
