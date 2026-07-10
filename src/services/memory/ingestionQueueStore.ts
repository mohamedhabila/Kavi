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
import { getMemoryDb } from './sqlite-store';

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
  | 'source_window_unavailable'
  | 'stale_processing_lease';

export interface IngestionJob {
  id: string;
  threadId: string;
  threadTitle: string | null;
  memoryConversationId: string;
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

interface IngestionJobRow {
  id: string;
  thread_id: string;
  thread_title: string | null;
  memory_conversation_id: string;
  task_id: string | null;
  source_run_id: string | null;
  chat_provider_id: string | null;
  chat_model: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string;
  source_at: number;
  reason: string;
  status: string;
  attempt_count: number;
  provider_enrichment?: number;
  provider_outcome: string | null;
  outcome_code: string | null;
  next_attempt_at: number | null;
  lease_expires_at: number | null;
  claim_token: string | null;
  structural_completed_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function rowToJob(row: IngestionJobRow): IngestionJob {
  const threadId = row.thread_id;
  return {
    id: row.id,
    threadId,
    threadTitle: row.thread_title,
    memoryConversationId: row.memory_conversation_id,
    taskId: row.task_id,
    sourceRunId: row.source_run_id,
    chatProviderId: row.chat_provider_id,
    chatModel: row.chat_model,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
    sourceAt: row.source_at,
    reason: row.reason as IngestionJobReason,
    status: row.status as IngestionJobStatus,
    attemptCount: row.attempt_count,
    providerEnrichment: row.provider_enrichment !== 0,
    providerOutcome: row.provider_outcome as IngestionProviderOutcome | null,
    outcomeCode: row.outcome_code as IngestionOutcomeCode | null,
    nextAttemptAt: row.next_attempt_at,
    leaseExpiresAt: row.lease_expires_at,
    claimToken: row.claim_token,
    structuralCompletedAt: row.structural_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export interface EnqueueIngestionJobInput {
  threadId: string;
  threadTitle?: string | null;
  memoryConversationId?: string | null;
  sourceEndMessageId: string;
  sourceAt?: number;
  sourceStartMessageId?: string | null;
  taskId?: string | null;
  sourceRunId?: string | null;
  chatProviderId?: string | null;
  chatModel?: string | null;
  reason?: IngestionJobReason;
  providerEnrichment?: boolean;
  now?: number;
}

export function enqueueIngestionJob(input: EnqueueIngestionJobInput): IngestionJob | null {
  ensureFactSchema();
  const db = getMemoryDb();
  const now = input.now ?? Date.now();
  const threadId = input.threadId.trim();
  const memoryConversationId = input.memoryConversationId?.trim() || threadId;
  const sourceEndMessageId = input.sourceEndMessageId.trim();
  const threadTitle = input.threadTitle?.trim() || null;
  const sourceStartMessageId = input.sourceStartMessageId?.trim() || null;
  const taskId = input.taskId?.trim() || null;
  const sourceRunId = input.sourceRunId?.trim() || null;
  const chatProviderId = input.chatProviderId?.trim() || null;
  const chatModel = chatProviderId ? input.chatModel?.trim() || null : null;
  const sourceAt =
    typeof input.sourceAt === 'number' && Number.isFinite(input.sourceAt) && input.sourceAt >= 0
      ? input.sourceAt
      : now;
  if (!threadId || !sourceEndMessageId) return null;

  const duplicate = db.getFirstSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs
       WHERE thread_id = ?
         AND source_end_message_id = ?
       LIMIT 1`,
    threadId,
    sourceEndMessageId,
  );
  if (duplicate) return rowToJob(duplicate);

  const id = newId('ingest');
  const inserted = db.runSync(
    `INSERT OR IGNORE INTO memory_ingestion_jobs
       (id, thread_id, thread_title, memory_conversation_id, task_id, source_run_id,
        chat_provider_id, chat_model, source_start_message_id, source_end_message_id,
        source_at, reason, status, attempt_count, provider_enrichment, provider_outcome, outcome_code,
        next_attempt_at, lease_expires_at, structural_completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, NULL, NULL, ?, ?)`,
    id,
    threadId,
    threadTitle,
    memoryConversationId,
    taskId,
    sourceRunId,
    chatProviderId,
    chatModel,
    sourceStartMessageId,
    sourceEndMessageId,
    sourceAt,
    input.reason ?? 'turn_completed',
    input.providerEnrichment === false ? 0 : 1,
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
    return existing ? rowToJob(existing) : null;
  }
  return rowToJob({
    id,
    thread_id: threadId,
    thread_title: threadTitle,
    memory_conversation_id: memoryConversationId,
    task_id: taskId,
    source_run_id: sourceRunId,
    chat_provider_id: chatProviderId,
    chat_model: chatModel,
    source_start_message_id: sourceStartMessageId,
    source_end_message_id: sourceEndMessageId,
    source_at: sourceAt,
    reason: input.reason ?? 'turn_completed',
    status: 'pending',
    attempt_count: 0,
    provider_enrichment: input.providerEnrichment === false ? 0 : 1,
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

export function countCompletedIngestionJobsForThread(threadId: string): number {
  ensureFactSchema();
  const trimmed = threadId.trim();
  if (!trimmed) return 0;
  const row = getMemoryDb().getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM memory_ingestion_jobs
      WHERE thread_id = ?
        AND status IN ('completed_structural', 'completed_enriched')`,
    trimmed,
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
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT ?`,
    now,
    Math.max(1, limit),
  );
  return rows.map(rowToJob);
}

export function getIngestionJob(jobId: string): IngestionJob | null {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs WHERE id = ? LIMIT 1`,
    jobId,
  );
  return row ? rowToJob(row) : null;
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
  if (
    !current ||
    current.status !== 'processing' ||
    current.claim_token !== input.claimToken
  ) {
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

const ALL_INGESTION_STATUSES: IngestionJobStatus[] = [
  'pending',
  'processing',
  'retrying',
  'degraded',
  'completed_structural',
  'completed_enriched',
  'failed',
];

const ALL_PROVIDER_OUTCOMES: IngestionProviderOutcome[] = [
  'structural_only',
  'valid',
  'empty_valid',
  'malformed',
  'schema_invalid',
  'provider_error',
];

export interface IngestionQueueDiagnostics {
  total: number;
  byStatus: Record<IngestionJobStatus, number>;
  byProviderOutcome: Record<IngestionProviderOutcome, number>;
  dueRetryCount: number;
  staleProcessingCount: number;
}

export function getIngestionQueueDiagnostics(now = Date.now()): IngestionQueueDiagnostics {
  ensureFactSchema();
  const db = getMemoryDb();
  const statusRows = db.getAllSync<{ status: IngestionJobStatus; count: number }>(
    'SELECT status, COUNT(*) AS count FROM memory_ingestion_jobs GROUP BY status',
  );
  const providerRows = db.getAllSync<{
    provider_outcome: IngestionProviderOutcome;
    count: number;
  }>(
    `SELECT provider_outcome, COUNT(*) AS count
       FROM memory_ingestion_jobs
      WHERE provider_outcome IS NOT NULL
      GROUP BY provider_outcome`,
  );
  const byStatus = Object.fromEntries(
    ALL_INGESTION_STATUSES.map((status) => [status, 0]),
  ) as Record<IngestionJobStatus, number>;
  const byProviderOutcome = Object.fromEntries(
    ALL_PROVIDER_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<IngestionProviderOutcome, number>;
  for (const row of statusRows) byStatus[row.status] = Math.max(0, row.count);
  for (const row of providerRows) {
    byProviderOutcome[row.provider_outcome] = Math.max(0, row.count);
  }
  const dueRetryCount =
    db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM memory_ingestion_jobs
        WHERE status IN ('pending', 'retrying')
          AND next_attempt_at <= ?`,
      now,
    )?.count ?? 0;
  const staleProcessingCount =
    db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM memory_ingestion_jobs
        WHERE status = 'processing'
          AND lease_expires_at <= ?`,
      now,
    )?.count ?? 0;

  return {
    total: statusRows.reduce((sum, row) => sum + Math.max(0, row.count), 0),
    byStatus,
    byProviderOutcome,
    dueRetryCount: Math.max(0, dueRetryCount),
    staleProcessingCount: Math.max(0, staleProcessingCount),
  };
}
