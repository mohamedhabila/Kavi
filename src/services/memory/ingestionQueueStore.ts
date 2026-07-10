// ---------------------------------------------------------------------------
// Kavi — Durable memory ingestion queue state
// ---------------------------------------------------------------------------
// Owns persistence, claiming, retry scheduling, stale-lease recovery, and
// diagnostics for the post-turn ingestion queue. Processing orchestration
// remains in ingestionQueue.ts.
// ---------------------------------------------------------------------------

import { INGESTION_BATCH_LIMIT, MAX_INGESTION_ATTEMPTS } from './onDeviceGuards';
import { runMemoryTransaction } from './access/transaction';
import { ensureFactSchema, newId } from './schema';
import { isMemoryIngestionSourceWithdrawn } from './withdrawalFence';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { getMemoryDb } from './sqlite-store';
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

export const INGESTION_RETRY_BASE_DELAY_MS = 15_000;
export const INGESTION_RETRY_MAX_DELAY_MS = 5 * 60_000;
export const INGESTION_PROCESSING_LEASE_MS = 5 * 60_000;

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
  | 'source_window_unavailable'
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
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
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
  sourceAt: number;
  sourceStartMessageId: string | null;
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
    sourceStartMessageId,
    sourceEndMessageId,
    sourceRunId,
    sourceAt,
    chatProviderId,
    chatModel,
    reason: input.reason,
    providerEnrichment: input.providerEnrichment,
  };
  if (
    isMemoryIngestionSourceWithdrawn({
      memoryConversationId,
      sourceThreadId: threadId,
      taskId,
      sourceStartMessageId,
      sourceEndMessageId,
      sourceRunId,
    })
  ) {
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
  if (duplicate) return requireMatchingIngestionSourceIdentity(duplicate, sourceIdentity);

  const id = newId('ingest');
  const inserted = db.runSync(
    `INSERT OR IGNORE INTO memory_ingestion_jobs
       (id, thread_id, thread_title, memory_conversation_id, persona_id, task_id, source_run_id,
        chat_provider_id, chat_model, source_start_message_id, source_end_message_id,
        source_at, reason, status, attempt_count, provider_enrichment, provider_outcome, outcome_code,
        next_attempt_at, lease_expires_at, structural_completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, NULL, NULL, ?, ?)`,
    id,
    threadId,
    threadTitle,
    memoryConversationId,
    personaId,
    taskId,
    sourceRunId,
    chatProviderId,
    chatModel,
    sourceStartMessageId,
    sourceEndMessageId,
    sourceAt,
    input.reason,
    input.providerEnrichment ? 1 : 0,
    now,
    now,
    now,
  );
  if ((inserted.changes ?? 0) === 0) {
    const existing = db.getFirstSync<IngestionJobRow>(
      `SELECT * FROM memory_ingestion_jobs
        WHERE thread_id = ? AND source_end_message_id = ?
        LIMIT 1`,
      threadId,
      sourceEndMessageId,
    );
    return existing ? requireMatchingIngestionSourceIdentity(existing, sourceIdentity) : null;
  }
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
    source_start_message_id: sourceStartMessageId,
    source_end_message_id: sourceEndMessageId,
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
    structural_completed_at: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  });
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

export function getNextPendingIngestionAttemptAt(): number | null {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<{ next_attempt_at: number | null }>(
    `SELECT MIN(wake_at) AS next_attempt_at
       FROM (
         SELECT next_attempt_at AS wake_at
           FROM memory_ingestion_jobs
          WHERE status IN ('pending', 'retrying')
         UNION ALL
         SELECT lease_expires_at AS wake_at
           FROM memory_ingestion_jobs
          WHERE status = 'processing'
       )`,
  );
  return row?.next_attempt_at ?? null;
}

export function discardPendingIngestionJobs(): number {
  ensureFactSchema();
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
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

export function failIngestionJobForInvalidIdentity(
  jobId: string,
  outcomeCode: 'persona_scope_missing' | 'source_identity_invalid',
  now: number,
): boolean {
  ensureFactSchema();
  const failedAt = requireIngestionTimestamp(now, 'memory_ingestion_clock_invalid');
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
    db.runSync('DELETE FROM memory_ingestion_receipts WHERE job_id = ?', jobId);
    const result = db.runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'failed',
              provider_outcome = NULL,
              outcome_code = ?,
              next_attempt_at = NULL,
              lease_expires_at = NULL,
              claim_token = NULL,
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
    `SELECT * FROM memory_ingestion_jobs
       WHERE status IN ('pending', 'retrying')
         AND next_attempt_at <= ?
       ORDER BY CASE WHEN structural_completed_at IS NULL THEN 0 ELSE 1 END ASC,
                next_attempt_at ASC,
                created_at ASC
       LIMIT ?`,
    now,
    Math.max(1, limit),
  );
  const jobs: IngestionJob[] = [];
  for (const row of rows) {
    const job = rowToIngestionJob(row);
    if (hasSealedIngestionJobIdentity(job)) {
      jobs.push(job);
      continue;
    }
    failIngestionJobForInvalidIdentity(job.id, ingestionIdentityFailureCode(job), now);
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
  return row ? rowToIngestionJob(row) : null;
}

export function computeNextIngestionAttemptAt(now: number, attemptCount: number): number {
  const exponent = Math.max(0, Math.min(MAX_INGESTION_ATTEMPTS - 1, attemptCount - 1));
  const delay = Math.min(
    INGESTION_RETRY_MAX_DELAY_MS,
    INGESTION_RETRY_BASE_DELAY_MS * 2 ** exponent,
  );
  return now + delay;
}

export function claimIngestionJob(jobId: string, now: number): string | null {
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
  const result = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           provider_outcome = NULL,
           outcome_code = NULL,
           next_attempt_at = NULL,
           lease_expires_at = ?,
           claim_token = ?,
           completed_at = NULL,
           updated_at = ?
     WHERE id = ?
       AND status IN ('pending', 'retrying')
       AND next_attempt_at <= ?
       AND attempt_count < ?`,
    now + INGESTION_PROCESSING_LEASE_MS,
    claimToken,
    now,
    jobId,
    now,
    MAX_INGESTION_ATTEMPTS,
  );
  return result.changes === 1 ? claimToken : null;
}

export function ownsIngestionClaim(jobId: string, claimToken: string, now: number): boolean {
  return Boolean(
    getMemoryDb().getFirstSync<{ present: number }>(
      `SELECT 1 AS present
         FROM memory_ingestion_jobs
        WHERE id = ?
          AND status = 'processing'
          AND claim_token = ?
          AND lease_expires_at > ?
        LIMIT 1`,
      jobId,
      claimToken,
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
           structural_completed_at = COALESCE(structural_completed_at, ?),
           completed_at = ?,
           updated_at = ?
     WHERE id = ?
       AND status = 'processing'
       AND claim_token = ?
       AND lease_expires_at > ?`,
    status,
    providerOutcome,
    now,
    now,
    now,
    jobId,
    claimToken,
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
        AND lease_expires_at > ?`,
    now,
    now,
    jobId,
    claimToken,
    now,
  );
  return result.changes === 1;
}

function reconcileStructuralCompletion(jobId: string, claimToken: string): void {
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
      WHERE id = ? AND status = 'processing' AND claim_token = ?`,
    jobId,
    claimToken,
  );
}

export interface IngestionTransitionResult {
  status: IngestionJobStatus;
  applied: boolean;
}

export function retryOrCompleteIngestionJob(input: {
  jobId: string;
  providerOutcome: IngestionProviderOutcome | null;
  outcomeCode: IngestionOutcomeCode;
  now: number;
  claimToken: string;
}): IngestionTransitionResult {
  reconcileStructuralCompletion(input.jobId, input.claimToken);
  const current = getMemoryDb().getFirstSync<{
    attempt_count: number;
    status: string;
    structural_completed_at: number | null;
    claim_token: string | null;
  }>(
    `SELECT attempt_count, status, structural_completed_at, claim_token
       FROM memory_ingestion_jobs
      WHERE id = ?
      LIMIT 1`,
    input.jobId,
  );
  if (!current || current.status !== 'processing' || current.claim_token !== input.claimToken) {
    return {
      status: (current?.status as IngestionJobStatus | undefined) ?? 'failed',
      applied: false,
    };
  }

  const terminal = current.attempt_count >= MAX_INGESTION_ATTEMPTS;
  const status: IngestionJobStatus = terminal
    ? current.structural_completed_at !== null
      ? 'degraded'
      : 'failed'
    : 'retrying';
  const nextAttemptAt = terminal
    ? null
    : computeNextIngestionAttemptAt(input.now, current.attempt_count);

  const updated = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = ?,
           provider_outcome = ?,
           outcome_code = ?,
           next_attempt_at = ?,
           lease_expires_at = NULL,
           claim_token = NULL,
           completed_at = ?,
           updated_at = ?
     WHERE id = ?
       AND status = 'processing'
       AND claim_token = ?`,
    status,
    input.providerOutcome,
    input.outcomeCode,
    nextAttemptAt,
    terminal ? input.now : null,
    input.now,
    input.jobId,
    input.claimToken,
  );
  return { status, applied: updated.changes === 1 };
}
