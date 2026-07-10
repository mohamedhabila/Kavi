// ---------------------------------------------------------------------------
// Kavi — Durable memory ingestion queue state
// ---------------------------------------------------------------------------
// Owns persistence, claiming, retry scheduling, stale-lease recovery, and
// diagnostics for the post-turn ingestion queue. Processing orchestration
// remains in ingestionQueue.ts.
// ---------------------------------------------------------------------------

import { INGESTION_BATCH_LIMIT, MAX_INGESTION_ATTEMPTS } from './onDeviceGuards';
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
  | 'stale_processing_lease';

export interface IngestionJob {
  id: string;
  threadId: string;
  memoryConversationId: string;
  taskId: string | null;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
  reason: IngestionJobReason;
  status: IngestionJobStatus;
  attemptCount: number;
  providerEnrichment: boolean;
  providerOutcome: IngestionProviderOutcome | null;
  outcomeCode: IngestionOutcomeCode | null;
  nextAttemptAt: number | null;
  leaseExpiresAt: number | null;
  structuralCompletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface IngestionJobRow {
  id: string;
  thread_id: string;
  memory_conversation_id?: string | null;
  task_id: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string;
  reason: string;
  status: string;
  attempt_count: number;
  provider_enrichment?: number;
  provider_outcome: string | null;
  outcome_code: string | null;
  next_attempt_at: number | null;
  lease_expires_at: number | null;
  structural_completed_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function rowToJob(row: IngestionJobRow): IngestionJob {
  const threadId = row.thread_id;
  const memoryConversationId = row.memory_conversation_id?.trim() || threadId;
  return {
    id: row.id,
    threadId,
    memoryConversationId,
    taskId: row.task_id,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
    reason: row.reason as IngestionJobReason,
    status: row.status as IngestionJobStatus,
    attemptCount: row.attempt_count,
    providerEnrichment: row.provider_enrichment !== 0,
    providerOutcome: row.provider_outcome as IngestionProviderOutcome | null,
    outcomeCode: row.outcome_code as IngestionOutcomeCode | null,
    nextAttemptAt: row.next_attempt_at,
    leaseExpiresAt: row.lease_expires_at,
    structuralCompletedAt: row.structural_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export interface EnqueueIngestionJobInput {
  threadId: string;
  memoryConversationId?: string | null;
  sourceEndMessageId: string;
  sourceStartMessageId?: string | null;
  taskId?: string | null;
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
       (id, thread_id, memory_conversation_id, task_id, source_start_message_id, source_end_message_id,
        reason, status, attempt_count, provider_enrichment, provider_outcome, outcome_code,
        next_attempt_at, lease_expires_at, structural_completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, NULL, NULL, ?, ?)`,
    id,
    threadId,
    memoryConversationId,
    input.taskId ?? null,
    input.sourceStartMessageId ?? null,
    sourceEndMessageId,
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
    memory_conversation_id: memoryConversationId,
    task_id: input.taskId ?? null,
    source_start_message_id: input.sourceStartMessageId ?? null,
    source_end_message_id: sourceEndMessageId,
    reason: input.reason ?? 'turn_completed',
    status: 'pending',
    attempt_count: 0,
    provider_enrichment: input.providerEnrichment === false ? 0 : 1,
    provider_outcome: null,
    outcome_code: null,
    next_attempt_at: now,
    lease_expires_at: null,
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
  recoverStaleIngestionJobs(now);
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

export function claimIngestionJob(jobId: string, now: number): boolean {
  const result = getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           provider_outcome = NULL,
           outcome_code = NULL,
           next_attempt_at = NULL,
           lease_expires_at = ?,
           completed_at = NULL,
           updated_at = ?
     WHERE id = ?
       AND status IN ('pending', 'retrying')
       AND next_attempt_at <= ?
       AND attempt_count < ?`,
    now + INGESTION_PROCESSING_LEASE_MS,
    now,
    jobId,
    now,
    MAX_INGESTION_ATTEMPTS,
  );
  return result.changes === 1;
}

export function completeIngestionJob(
  jobId: string,
  status: 'completed_structural' | 'completed_enriched',
  providerOutcome: IngestionProviderOutcome,
  now: number,
): void {
  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = ?,
           provider_outcome = ?,
           outcome_code = NULL,
           next_attempt_at = NULL,
           lease_expires_at = NULL,
           structural_completed_at = COALESCE(structural_completed_at, ?),
           completed_at = ?,
           updated_at = ?
     WHERE id = ?
       AND status = 'processing'`,
    status,
    providerOutcome,
    now,
    now,
    now,
    jobId,
  );
}

export function markIngestionJobStructuralComplete(jobId: string, now: number): void {
  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
        SET structural_completed_at = COALESCE(structural_completed_at, ?),
            updated_at = ?
      WHERE id = ? AND status = 'processing'`,
    now,
    now,
    jobId,
  );
}

export function retryOrCompleteIngestionJob(input: {
  jobId: string;
  providerOutcome: IngestionProviderOutcome | null;
  outcomeCode: IngestionOutcomeCode;
  now: number;
}): IngestionJobStatus {
  const current = getMemoryDb().getFirstSync<{
    attempt_count: number;
    status: string;
    structural_completed_at: number | null;
  }>(
    `SELECT attempt_count, status, structural_completed_at
       FROM memory_ingestion_jobs
      WHERE id = ?
      LIMIT 1`,
    input.jobId,
  );
  if (!current || current.status !== 'processing') {
    return (current?.status as IngestionJobStatus | undefined) ?? 'failed';
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

  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = ?,
           provider_outcome = ?,
           outcome_code = ?,
           next_attempt_at = ?,
           lease_expires_at = NULL,
           completed_at = ?,
           updated_at = ?
     WHERE id = ?
       AND status = 'processing'`,
    status,
    input.providerOutcome,
    input.outcomeCode,
    nextAttemptAt,
    terminal ? input.now : null,
    input.now,
    input.jobId,
  );
  return status;
}

export interface StaleIngestionRecoveryResult {
  retrying: number;
  degraded: number;
  failed: number;
}

export function recoverStaleIngestionJobs(now = Date.now()): StaleIngestionRecoveryResult {
  ensureFactSchema();
  const stale = getMemoryDb().getAllSync<{ id: string }>(
    `SELECT id
       FROM memory_ingestion_jobs
      WHERE status = 'processing'
        AND lease_expires_at <= ?
      ORDER BY lease_expires_at ASC, created_at ASC`,
    now,
  );
  const result: StaleIngestionRecoveryResult = { retrying: 0, degraded: 0, failed: 0 };
  for (const row of stale) {
    const status = retryOrCompleteIngestionJob({
      jobId: row.id,
      providerOutcome: null,
      outcomeCode: 'stale_processing_lease',
      now,
    });
    if (status === 'retrying') result.retrying += 1;
    if (status === 'degraded') result.degraded += 1;
    if (status === 'failed') result.failed += 1;
  }
  return result;
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
