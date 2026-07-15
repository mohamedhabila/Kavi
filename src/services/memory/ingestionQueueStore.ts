// Durable ingestion persistence, claims, retries, recovery, and diagnostics.
// Processing orchestration remains in ingestionQueue.ts.

import { INGESTION_BATCH_LIMIT } from './onDeviceGuards';
import { runMemoryTransaction } from './access/transaction';
import { ensureFactSchema, newId } from './schema';
import { hasAnyRetiredExactMemorySource } from './exactMemorySourceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { getMemoryDb } from './database';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import {
  hasSealedIngestionJobIdentity,
  ingestionIdentityFailureCode,
  isValidIngestionThreadTitle,
  optionalIngestionProvenanceIdentity,
  optionalIngestionScopeIdentity,
  requireIngestionProvenanceIdentity,
  requireIngestionScopeIdentity,
  requireIngestionTimestamp,
  requireMatchingIngestionSourceIdentity,
  rowToIngestionJob,
} from './ingestionQueueIdentity';
import type { IngestionJobRow, IngestionSourceIdentity } from './ingestionQueueIdentity';
import { NO_BLOCKING_PRIOR_DEPENDENCY_SQL } from './ingestionQueueDependencies';
import { failIngestionJobForInvalidIdentity } from './ingestionQueueIdentityFailure';
import { claimIngestionJobForFullProcessing } from './ingestionQueueStructuralCheckpoint';
import { getRuntimeProcessEpoch } from '../runtimeProcessEpoch';
import type { EncodedIngestionSourceSnapshot } from './ingestionSourceSnapshot';
import {
  ensureActiveIngestionSourceSnapshot,
  insertIngestionSourceSnapshot,
  requireMatchingIngestionSourceSnapshot,
  validateIngestionSourceSnapshotForIdentity,
} from './ingestionSourceSnapshotStore';
import {
  buildIngestionJobSourcesFromSnapshot,
  insertIngestionJobSources,
  requireMatchingIngestionJobSources,
} from './ingestionJobSources';

export { getNextPendingIngestionAttemptAt } from './ingestionQueueDependencies';
export { failIngestionJobForInvalidIdentity } from './ingestionQueueIdentityFailure';
export {
  recoverIngestionJobClaim,
  retryOrCompleteIngestionJob,
  type IngestionTransitionResult,
} from './ingestionQueueClaimTransition';
export {
  computeNextIngestionAttemptAt,
  INGESTION_RETRY_BASE_DELAY_MS,
  INGESTION_RETRY_MAX_DELAY_MS,
} from './ingestionQueueRetryPolicy';
export {
  claimIngestionJobForStructuralCheckpoint,
  claimIngestionJobWithSourceSnapshot,
  deferIngestionEnrichmentAfterStructuralCheckpoint,
  INGESTION_PROCESSING_LEASE_MS,
  type ClaimedIngestionSourceSnapshot,
} from './ingestionQueueStructuralCheckpoint';

export type IngestionJobStatus =
  | 'pending'
  | 'processing'
  | 'retrying'
  | 'degraded'
  | 'completed_structural'
  | 'completed_enriched'
  | 'failed';
export type IngestionJobReason = 'turn_completed' | 'migration' | 'manual';
export type IngestionProviderOutcome =
  | 'structural_only'
  | 'valid'
  | 'empty_valid'
  | 'malformed'
  | 'schema_invalid'
  | 'provider_error';

export type IngestionOutcomeCode =
  | 'empty_response'
  | 'invalid_json'
  | 'non_object'
  | 'missing_required_field'
  | 'unexpected_field'
  | 'invalid_field_type'
  | 'invalid_field_value'
  | 'limit_exceeded'
  | 'provider_request_failed'
  | 'unsupported_response_shape'
  | 'processing_incomplete'
  | 'processing_error'
  | 'persona_scope_missing'
  | 'source_identity_invalid'
  | 'source_identity_conflict'
  | 'source_snapshot_missing'
  | 'source_snapshot_invalid'
  | 'stale_processing_lease';

export interface IngestionJob {
  id: string;
  threadId: string;
  threadTitle: string | null;
  memoryConversationId: string;
  personaId: string | null;
  taskId: string | null;
  sourceRunId: string | null;
  chatProviderId: string | null;
  chatModel: string | null;
  priorUserMessageId: string | null;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
  sourceSnapshotVersion: number | null;
  sourceSnapshotSha256: string | null;
  sourceSnapshotByteLength: number | null;
  sourceAt: number;
  reason: IngestionJobReason;
  status: IngestionJobStatus;
  attemptCount: number;
  providerEnrichment: boolean;
  providerOutcome: IngestionProviderOutcome | null;
  outcomeCode: IngestionOutcomeCode | null;
  nextAttemptAt: number | null;
  leaseExpiresAt: number | null;
  claimToken: string | null;
  claimProcessEpoch: string | null;
  structuralCompletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface EnqueueIngestionJobInput {
  threadId: string;
  threadTitle: string | null;
  memoryConversationId: string;
  personaId: string;
  sourceEndMessageId: string;
  sourceSnapshot: EncodedIngestionSourceSnapshot;
  sourceAt: number;
  sourceStartMessageId: string | null;
  priorUserMessageId?: string | null;
  taskId: string | null;
  sourceRunId: string | null;
  chatProviderId: string | null;
  chatModel: string | null;
  reason: IngestionJobReason;
  providerEnrichment: boolean;
  now?: number;
}

export function enqueueIngestionJob(input: EnqueueIngestionJobInput): IngestionJob | null {
  ensureFactSchema();
  const db = getMemoryDb();
  const now = requireIngestionTimestamp(input.now ?? Date.now(), 'memory_ingestion_clock_invalid');
  const threadId = requireIngestionScopeIdentity(
    input.threadId,
    'memory_ingestion_thread_scope_invalid',
  );
  const memoryConversationId = requireIngestionScopeIdentity(
    input.memoryConversationId,
    'memory_ingestion_conversation_scope_invalid',
  );
  const personaId = isExactMemoryScopeId(input.personaId) ? input.personaId : null;
  const sourceEndMessageId = requireIngestionProvenanceIdentity(
    input.sourceEndMessageId,
    'memory_ingestion_source_end_invalid',
  );
  const threadTitle = input.threadTitle;
  if (!isValidIngestionThreadTitle(threadTitle)) {
    throw new Error('memory_ingestion_thread_title_invalid');
  }
  const sourceStartMessageId = optionalIngestionProvenanceIdentity(
    input.sourceStartMessageId,
    'memory_ingestion_source_start_invalid',
  );
  const priorUserMessageId = optionalIngestionProvenanceIdentity(
    input.priorUserMessageId,
    'memory_ingestion_prior_user_invalid',
  );
  const taskId = optionalIngestionScopeIdentity(
    input.taskId,
    'memory_ingestion_task_scope_invalid',
  );
  const sourceRunId = optionalIngestionProvenanceIdentity(
    input.sourceRunId,
    'memory_ingestion_run_invalid',
  );
  const chatProviderId = optionalIngestionScopeIdentity(
    input.chatProviderId,
    'memory_ingestion_chat_provider_invalid',
  );
  const chatModel = optionalIngestionProvenanceIdentity(
    input.chatModel,
    'memory_ingestion_chat_model_invalid',
  );
  if (chatProviderId === null && chatModel !== null) {
    throw new Error('memory_ingestion_chat_model_without_provider');
  }
  if (chatProviderId !== null && chatModel === null) {
    throw new Error('memory_ingestion_chat_model_missing');
  }
  if (
    input.reason !== 'turn_completed' &&
    input.reason !== 'migration' &&
    input.reason !== 'manual'
  ) {
    throw new Error('memory_ingestion_reason_invalid');
  }
  if (typeof input.providerEnrichment !== 'boolean') {
    throw new Error('memory_ingestion_provider_policy_invalid');
  }
  const sourceAt = requireIngestionTimestamp(
    input.sourceAt,
    'memory_ingestion_source_timestamp_invalid',
  );
  if (!personaId) throw new Error('memory_ingestion_persona_scope_invalid');
  const sourceIdentity: IngestionSourceIdentity = {
    threadId,
    threadTitle,
    memoryConversationId,
    personaId,
    taskId,
    priorUserMessageId,
    sourceStartMessageId,
    sourceEndMessageId,
    sourceRunId,
    sourceAt,
    chatProviderId,
    chatModel,
    reason: input.reason,
    providerEnrichment: input.providerEnrichment,
  };
  const sourceSnapshot = validateIngestionSourceSnapshotForIdentity(input.sourceSnapshot, {
    priorUserMessageId,
    sourceStartMessageId,
    sourceEndMessageId,
  });
  const exactSources = buildIngestionJobSourcesFromSnapshot(
    {
      memoryOwnerId: getLocalMemoryVaultOwnerId(db),
      memoryConversationId,
      sourceThreadId: threadId,
      taskId,
      sourceEndMessageId,
      sourceRunId,
    },
    sourceSnapshot,
  );
  if (hasAnyRetiredExactMemorySource(db, exactSources)) {
    return null;
  }

  let deferredFailureCode: string | null = null;
  const matchDuplicate = (row: IngestionJobRow): IngestionJob | null => {
    const persisted = rowToIngestionJob(row);
    if (!hasSealedIngestionJobIdentity(persisted)) {
      failIngestionJobForInvalidIdentity(
        persisted.id,
        ingestionIdentityFailureCode(persisted),
        now,
      );
      deferredFailureCode = 'memory_ingestion_source_identity_invalid';
      return null;
    }
    const existing = requireMatchingIngestionSourceIdentity(row, sourceIdentity);
    try {
      requireMatchingIngestionSourceSnapshot(db, row, input.sourceSnapshot, now);
      requireMatchingIngestionJobSources(db, row.id, exactSources);
      return existing;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'memory_ingestion_source_snapshot_missing' ||
          error.message === 'memory_ingestion_source_snapshot_invalid')
      ) {
        deferredFailureCode = error.message;
        return null;
      }
      throw error;
    }
  };

  const result = runMemoryTransaction(() => {
    if (hasAnyRetiredExactMemorySource(db, exactSources)) {
      return null;
    }
    const duplicate = db.getFirstSync<IngestionJobRow>(
      `SELECT * FROM memory_ingestion_jobs
        WHERE thread_id = ?
          AND source_end_message_id = ?
        LIMIT 1`,
      threadId,
      sourceEndMessageId,
    );
    if (duplicate) return matchDuplicate(duplicate);

    const id = newId('ingest');
    const inserted = db.runSync(
      `INSERT OR IGNORE INTO memory_ingestion_jobs
         (id, thread_id, thread_title, memory_conversation_id, persona_id, task_id, source_run_id,
          chat_provider_id, chat_model, prior_user_message_id, source_start_message_id,
          source_end_message_id, source_snapshot_version, source_snapshot_sha256,
          source_snapshot_byte_length, source_at, reason, status, attempt_count,
          provider_enrichment, provider_outcome, outcome_code, next_attempt_at,
          lease_expires_at, structural_completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL,
               ?, NULL, NULL, ?, ?)`,
      id,
      threadId,
      threadTitle,
      memoryConversationId,
      personaId,
      taskId,
      sourceRunId,
      chatProviderId,
      chatModel,
      priorUserMessageId,
      sourceStartMessageId,
      sourceEndMessageId,
      input.sourceSnapshot.snapshotVersion,
      input.sourceSnapshot.payloadSha256,
      input.sourceSnapshot.payloadByteLength,
      sourceAt,
      input.reason,
      input.providerEnrichment ? 1 : 0,
      now,
      now,
      now,
    );
    if ((inserted.changes ?? 0) === 0) {
      const winner = db.getFirstSync<IngestionJobRow>(
        `SELECT * FROM memory_ingestion_jobs
          WHERE thread_id = ? AND source_end_message_id = ?
          LIMIT 1`,
        threadId,
        sourceEndMessageId,
      );
      if (!winner) throw new Error('memory_ingestion_enqueue_conflict');
      return matchDuplicate(winner);
    }
    insertIngestionSourceSnapshot(db, id, input.sourceSnapshot, now);
    insertIngestionJobSources(db, id, exactSources);
    return rowToIngestionJob({
      id,
      thread_id: threadId,
      thread_title: threadTitle,
      memory_conversation_id: memoryConversationId,
      persona_id: personaId,
      task_id: taskId,
      source_run_id: sourceRunId,
      chat_provider_id: chatProviderId,
      chat_model: chatModel,
      prior_user_message_id: priorUserMessageId,
      source_start_message_id: sourceStartMessageId,
      source_end_message_id: sourceEndMessageId,
      source_snapshot_version: input.sourceSnapshot.snapshotVersion,
      source_snapshot_sha256: input.sourceSnapshot.payloadSha256,
      source_snapshot_byte_length: input.sourceSnapshot.payloadByteLength,
      source_at: sourceAt,
      reason: input.reason,
      status: 'pending',
      attempt_count: 0,
      provider_enrichment: input.providerEnrichment ? 1 : 0,
      provider_outcome: null,
      outcome_code: null,
      next_attempt_at: now,
      lease_expires_at: null,
      claim_token: null,
      claim_process_epoch: null,
      structural_completed_at: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    });
  });
  if (deferredFailureCode) throw new Error(deferredFailureCode);
  return result;
}

export function countPendingIngestionJobs(): number {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM memory_ingestion_jobs
      WHERE status IN ('pending', 'processing', 'retrying')`,
  );
  return Math.max(0, row?.count ?? 0);
}

export function discardPendingIngestionJobs(): number {
  ensureFactSchema();
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
    db.runSync(
      `DELETE FROM memory_ingestion_structural_receipts
        WHERE job_id IN (
          SELECT id FROM memory_ingestion_jobs
           WHERE status IN ('pending', 'processing', 'retrying')
        )`,
    );
    db.runSync(
      `DELETE FROM memory_ingestion_receipts
        WHERE job_id IN (
          SELECT id FROM memory_ingestion_jobs
           WHERE status IN ('pending', 'processing', 'retrying')
        )`,
    );
    const result = db.runSync(
      `DELETE FROM memory_ingestion_jobs
        WHERE status IN ('pending', 'processing', 'retrying')`,
    );
    return Math.max(0, result.changes ?? 0);
  });
}

export function discardIngestionJob(jobId: string): boolean {
  ensureFactSchema();
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
    db.runSync(
      `DELETE FROM memory_ingestion_structural_receipts
        WHERE job_id IN (
          SELECT id FROM memory_ingestion_jobs
           WHERE id = ? AND status IN ('pending', 'processing', 'retrying')
        )`,
      jobId,
    );
    db.runSync(
      `DELETE FROM memory_ingestion_receipts
        WHERE job_id IN (
          SELECT id FROM memory_ingestion_jobs
           WHERE id = ? AND status IN ('pending', 'processing', 'retrying')
        )`,
      jobId,
    );
    const result = db.runSync(
      `DELETE FROM memory_ingestion_jobs
        WHERE id = ? AND status IN ('pending', 'processing', 'retrying')`,
      jobId,
    );
    return (result.changes ?? 0) === 1;
  });
}

export function countCompletedIngestionJobsForThread(threadId: string): number {
  ensureFactSchema();
  if (!isExactMemoryScopeId(threadId)) return 0;
  const row = getMemoryDb().getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM memory_ingestion_jobs
      WHERE thread_id = ?
        AND status IN ('completed_structural', 'completed_enriched')`,
    threadId,
  );
  return Math.max(0, row?.count ?? 0);
}

export function listPendingIngestionJobs(
  limit = INGESTION_BATCH_LIMIT,
  now = Date.now(),
): IngestionJob[] {
  ensureFactSchema();
  const rows = getMemoryDb().getAllSync<IngestionJobRow>(
    `SELECT candidate.* FROM memory_ingestion_jobs AS candidate
       WHERE candidate.status IN ('pending', 'retrying')
         AND candidate.next_attempt_at <= ?
         AND ${NO_BLOCKING_PRIOR_DEPENDENCY_SQL}
       ORDER BY CASE WHEN candidate.structural_completed_at IS NULL THEN 0 ELSE 1 END ASC,
                candidate.next_attempt_at ASC,
                candidate.created_at ASC
       LIMIT ?`,
    now,
    Math.max(1, limit),
  );
  const jobs: IngestionJob[] = [];
  for (const row of rows) {
    const job = rowToIngestionJob(row);
    if (!hasSealedIngestionJobIdentity(job)) {
      failIngestionJobForInvalidIdentity(job.id, ingestionIdentityFailureCode(job), now);
      continue;
    }
    jobs.push(job);
  }
  return jobs;
}

export function getIngestionJob(jobId: string): IngestionJob | null {
  ensureFactSchema();
  if (!isExactMemoryScopeId(jobId)) return null;
  const row = getMemoryDb().getFirstSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs WHERE id = ? LIMIT 1`,
    jobId,
  );
  return row ? rowToIngestionJob(row) : null;
}

export function getIngestionJobForProcessing(jobId: string): IngestionJob | null {
  ensureFactSchema();
  if (typeof jobId !== 'string') return null;
  const row = getMemoryDb().getFirstSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs WHERE id = ? LIMIT 1`,
    jobId,
  );
  return row ? rowToIngestionJob(row) : null;
}

export function getIngestionJobForSourceTurn(input: {
  memoryConversationId: string;
  sourceThreadId: string;
  sourceEndMessageId: string;
}): IngestionJob | null {
  ensureFactSchema();
  if (
    !isExactMemoryScopeId(input.memoryConversationId) ||
    !isExactMemoryScopeId(input.sourceThreadId) ||
    !isExactMemoryProvenanceId(input.sourceEndMessageId)
  ) {
    return null;
  }
  const row = getMemoryDb().getFirstSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs
      WHERE memory_conversation_id = ?
        AND thread_id = ?
        AND source_end_message_id = ?
      LIMIT 1`,
    input.memoryConversationId,
    input.sourceThreadId,
    input.sourceEndMessageId,
  );
  if (!row) return null;
  const job = rowToIngestionJob(row);
  if (!hasSealedIngestionJobIdentity(job) || ensureActiveIngestionSourceSnapshot(row, Date.now())) {
    return job;
  }
  const terminal = getMemoryDb().getFirstSync<IngestionJobRow>(
    'SELECT * FROM memory_ingestion_jobs WHERE id = ? LIMIT 1',
    row.id,
  );
  return terminal ? rowToIngestionJob(terminal) : null;
}

export function claimIngestionJob(jobId: string, now: number): string | null {
  return claimIngestionJobForFullProcessing(jobId, now)?.claimToken ?? null;
}

export function ownsIngestionClaim(jobId: string, claimToken: string, now: number): boolean {
  return Boolean(
    getMemoryDb().getFirstSync<{ present: number }>(
      `SELECT 1 AS present
         FROM memory_ingestion_jobs
        WHERE id = ?
          AND status = 'processing'
          AND claim_token = ?
          AND claim_process_epoch = ?
          AND lease_expires_at > ?
        LIMIT 1`,
      jobId,
      claimToken,
      getRuntimeProcessEpoch(),
      now,
    ),
  );
}

export function completeIngestionJob(
  jobId: string,
  status: 'completed_structural' | 'completed_enriched',
  providerOutcome: IngestionProviderOutcome,
  now: number,
  claimToken: string,
): boolean {
  const result = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = ?,
           provider_outcome = ?,
           outcome_code = NULL,
           next_attempt_at = NULL,
           lease_expires_at = NULL,
           claim_token = NULL,
           claim_process_epoch = NULL,
           structural_completed_at = COALESCE(structural_completed_at, ?),
           completed_at = ?,
           updated_at = ?
     WHERE id = ?
       AND status = 'processing'
       AND claim_token = ?
       AND claim_process_epoch = ?
       AND lease_expires_at > ?`,
    status,
    providerOutcome,
    now,
    now,
    now,
    jobId,
    claimToken,
    getRuntimeProcessEpoch(),
    now,
  );
  return result.changes === 1;
}

export function markIngestionJobStructuralComplete(
  jobId: string,
  now: number,
  claimToken: string,
): boolean {
  const result = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
        SET structural_completed_at = COALESCE(structural_completed_at, ?),
            updated_at = ?
      WHERE id = ?
        AND status = 'processing'
        AND claim_token = ?
        AND claim_process_epoch = ?
        AND lease_expires_at > ?`,
    now,
    now,
    jobId,
    claimToken,
    getRuntimeProcessEpoch(),
    now,
  );
  return result.changes === 1;
}
