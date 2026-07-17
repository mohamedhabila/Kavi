import { getRuntimeProcessEpoch } from '../runtimeProcessEpoch';
import { getMemoryDb } from './database';
import { computeNextIngestionAttemptAt } from './ingestionQueueRetryPolicy';
import type {
  IngestionJobStatus,
  IngestionOutcomeCode,
  IngestionProviderOutcome,
} from './ingestionQueueStore';
import { MAX_INGESTION_ATTEMPTS } from './onDeviceGuards';

export interface PersistedIngestionClaim {
  jobId: string;
  claimToken: string;
  claimProcessEpoch: string;
  leaseExpiresAt: number;
}

export interface IngestionTransitionResult {
  status: IngestionJobStatus;
  applied: boolean;
}

function reconcileStructuralCompletion(claim: PersistedIngestionClaim): void {
  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
        SET structural_completed_at = COALESCE(
          structural_completed_at,
          (
            SELECT episode.created_at
              FROM memory_episodes AS episode
             WHERE episode.deleted_at IS NULL
               AND episode.conversation_id = memory_ingestion_jobs.memory_conversation_id
               AND episode.thread_id = memory_ingestion_jobs.thread_id
               AND episode.source_end_message_id = memory_ingestion_jobs.source_end_message_id
             LIMIT 1
          ),
          (
            SELECT fact.created_at
              FROM memory_facts AS fact
             WHERE fact.invalid_at IS NULL
               AND fact.deleted_at IS NULL
               AND fact.origin_conversation_id = memory_ingestion_jobs.memory_conversation_id
               AND fact.origin_thread_id = memory_ingestion_jobs.thread_id
               AND (
                 fact.source_turn_id = memory_ingestion_jobs.source_end_message_id
                 OR fact.source_message_id = memory_ingestion_jobs.source_end_message_id
               )
             LIMIT 1
          ),
          (
            SELECT evidence.created_at
              FROM memory_fact_evidence AS evidence
              JOIN memory_facts AS fact ON fact.id = evidence.fact_id
             WHERE fact.invalid_at IS NULL
               AND fact.deleted_at IS NULL
               AND fact.origin_conversation_id = memory_ingestion_jobs.memory_conversation_id
               AND fact.origin_thread_id = memory_ingestion_jobs.thread_id
               AND evidence.message_id = memory_ingestion_jobs.source_end_message_id
             LIMIT 1
          )
        )
      WHERE id = ?
        AND status = 'processing'
        AND claim_token = ?
        AND claim_process_epoch = ?
        AND lease_expires_at = ?`,
    claim.jobId,
    claim.claimToken,
    claim.claimProcessEpoch,
    claim.leaseExpiresAt,
  );
}

function currentIngestionStatus(jobId: string): IngestionJobStatus {
  return (
    getMemoryDb().getFirstSync<{ status: IngestionJobStatus }>(
      'SELECT status FROM memory_ingestion_jobs WHERE id = ? LIMIT 1',
      jobId,
    )?.status ?? 'failed'
  );
}

function transitionFailedIngestionClaim(input: {
  claim: PersistedIngestionClaim;
  providerOutcome: IngestionProviderOutcome | null;
  outcomeCode: IngestionOutcomeCode;
  now: number;
  retryImmediately: boolean;
  restoreInterruptedAttempt: boolean;
}): IngestionTransitionResult {
  reconcileStructuralCompletion(input.claim);
  const current = getMemoryDb().getFirstSync<{
    attempt_count: number;
    structural_completed_at: number | null;
  }>(
    `SELECT attempt_count, structural_completed_at
       FROM memory_ingestion_jobs
      WHERE id = ?
        AND status = 'processing'
        AND claim_token = ?
        AND claim_process_epoch = ?
        AND lease_expires_at = ?
      LIMIT 1`,
    input.claim.jobId,
    input.claim.claimToken,
    input.claim.claimProcessEpoch,
    input.claim.leaseExpiresAt,
  );
  if (!current) {
    return { status: currentIngestionStatus(input.claim.jobId), applied: false };
  }

  const attemptCount = input.restoreInterruptedAttempt
    ? Math.max(0, current.attempt_count - 1)
    : current.attempt_count;
  const terminal = attemptCount >= MAX_INGESTION_ATTEMPTS;
  const status: IngestionJobStatus = terminal
    ? current.structural_completed_at !== null
      ? 'degraded'
      : 'failed'
    : 'retrying';
  const nextAttemptAt = terminal
    ? null
    : input.retryImmediately
      ? input.now
      : computeNextIngestionAttemptAt(input.now, current.attempt_count);

  const updated = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = ?,
           attempt_count = ?,
           provider_outcome = ?,
           outcome_code = ?,
           next_attempt_at = ?,
           lease_expires_at = NULL,
           claim_token = NULL,
           claim_process_epoch = NULL,
           completed_at = ?,
           updated_at = ?
     WHERE id = ?
       AND status = 'processing'
       AND claim_token = ?
       AND claim_process_epoch = ?
       AND lease_expires_at = ?`,
    status,
    attemptCount,
    input.providerOutcome,
    input.outcomeCode,
    nextAttemptAt,
    terminal ? input.now : null,
    input.now,
    input.claim.jobId,
    input.claim.claimToken,
    input.claim.claimProcessEpoch,
    input.claim.leaseExpiresAt,
  );
  return { status, applied: updated.changes === 1 };
}

export function retryOrCompleteIngestionJob(input: {
  jobId: string;
  providerOutcome: IngestionProviderOutcome | null;
  outcomeCode: IngestionOutcomeCode;
  now: number;
  claimToken: string;
}): IngestionTransitionResult {
  const claimProcessEpoch = getRuntimeProcessEpoch();
  const claim = getMemoryDb().getFirstSync<{ lease_expires_at: number }>(
    `SELECT lease_expires_at
       FROM memory_ingestion_jobs
      WHERE id = ?
        AND status = 'processing'
        AND claim_token = ?
        AND claim_process_epoch = ?
        AND lease_expires_at > ?
      LIMIT 1`,
    input.jobId,
    input.claimToken,
    claimProcessEpoch,
    input.now,
  );
  if (!claim) {
    return { status: currentIngestionStatus(input.jobId), applied: false };
  }
  return transitionFailedIngestionClaim({
    claim: {
      jobId: input.jobId,
      claimToken: input.claimToken,
      claimProcessEpoch,
      leaseExpiresAt: claim.lease_expires_at,
    },
    providerOutcome: input.providerOutcome,
    outcomeCode: input.outcomeCode,
    now: input.now,
    retryImmediately: false,
    restoreInterruptedAttempt: false,
  });
}

export function recoverIngestionJobClaim(input: PersistedIngestionClaim & {
  now: number;
}): IngestionTransitionResult {
  const foreignProcess = input.claimProcessEpoch !== getRuntimeProcessEpoch();
  if (!foreignProcess && input.leaseExpiresAt > input.now) {
    return { status: currentIngestionStatus(input.jobId), applied: false };
  }
  return transitionFailedIngestionClaim({
    claim: input,
    providerOutcome: null,
    outcomeCode: 'stale_processing_lease',
    now: input.now,
    retryImmediately: foreignProcess,
    restoreInterruptedAttempt: foreignProcess,
  });
}
