import { MAX_INGESTION_ATTEMPTS } from './onDeviceGuards';
import { ensureFactSchema } from './schema';
import { getMemoryDb } from './database';
import {
  computeNextIngestionAttemptAt,
  retryOrCompleteIngestionJob,
  type IngestionJobStatus,
  type IngestionTransitionResult,
} from './ingestionQueueStore';

export interface StaleIngestionRecoveryResult {
  retrying: number;
  degraded: number;
  failed: number;
}

export function deferIngestionJobForMissingSource(
  jobId: string,
  now: number,
): IngestionTransitionResult {
  const current = getMemoryDb().getFirstSync<{
    status: IngestionJobStatus;
    attempt_count: number;
    next_attempt_at: number | null;
  }>(
    `SELECT status, attempt_count, next_attempt_at
       FROM memory_ingestion_jobs
      WHERE id = ?
      LIMIT 1`,
    jobId,
  );
  if (
    !current ||
    !['pending', 'retrying'].includes(current.status) ||
    (current.next_attempt_at ?? Number.POSITIVE_INFINITY) > now
  ) {
    return { status: current?.status ?? 'failed', applied: false };
  }

  const attemptCount = current.attempt_count + 1;
  const terminal = attemptCount >= MAX_INGESTION_ATTEMPTS;
  const status: IngestionJobStatus = terminal ? 'failed' : 'retrying';
  const nextAttemptAt = terminal ? null : computeNextIngestionAttemptAt(now, attemptCount);
  const updated = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
        SET status = ?,
            attempt_count = ?,
            provider_outcome = NULL,
            outcome_code = 'source_window_unavailable',
            next_attempt_at = ?,
            lease_expires_at = NULL,
            claim_token = NULL,
            completed_at = ?,
            updated_at = ?
      WHERE id = ?
        AND status = ?
        AND attempt_count = ?
        AND next_attempt_at <= ?`,
    status,
    attemptCount,
    nextAttemptAt,
    terminal ? now : null,
    now,
    jobId,
    current.status,
    current.attempt_count,
    now,
  );
  return { status, applied: updated.changes === 1 };
}

export function recoverStaleIngestionJobs(now = Date.now()): StaleIngestionRecoveryResult {
  ensureFactSchema();
  const stale = getMemoryDb().getAllSync<{ id: string; claim_token: string }>(
    `SELECT id, claim_token
       FROM memory_ingestion_jobs
      WHERE status = 'processing'
        AND lease_expires_at <= ?
      ORDER BY lease_expires_at ASC, created_at ASC`,
    now,
  );
  const result: StaleIngestionRecoveryResult = { retrying: 0, degraded: 0, failed: 0 };
  for (const row of stale) {
    const transition = retryOrCompleteIngestionJob({
      jobId: row.id,
      providerOutcome: null,
      outcomeCode: 'stale_processing_lease',
      now,
      claimToken: row.claim_token,
    });
    if (!transition.applied) continue;
    if (transition.status === 'retrying') result.retrying += 1;
    if (transition.status === 'degraded') result.degraded += 1;
    if (transition.status === 'failed') result.failed += 1;
  }
  return result;
}
