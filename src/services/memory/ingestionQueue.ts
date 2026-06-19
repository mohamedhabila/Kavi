// ---------------------------------------------------------------------------
// Kavi — Memory ingestion queue
// ---------------------------------------------------------------------------
// Durable, restart-safe queue for post-turn consolidation. Layer-1 working
// memory updates happen synchronously in turnProcessor; this queue handles
// episode/fact enrichment without blocking chat responses.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import { runConsolidation } from './consolidation/orchestrator';
import {
  acquireIngestionSlot,
  INGESTION_BATCH_LIMIT,
  MAX_INGESTION_ATTEMPTS,
  releaseIngestionSlot,
  shouldAbortIngestionDueToMemoryPressure,
} from './onDeviceGuards';
import { composeActiveFocusContent } from './focus';
import { ensureFactSchema, newId } from './schema';
import { getMemoryDb } from './sqlite-store';
import { refreshThreadReflection } from './reflections';
import { editWorkingBlock, getWorkingBlock } from './workingBlocks';

const logger = createLogger('memory.ingestionQueue');

export type IngestionJobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type IngestionJobReason = 'turn_completed' | 'migration' | 'manual';

export interface IngestionJob {
  id: string;
  threadId: string;
  taskId: string | null;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
  reason: IngestionJobReason;
  status: IngestionJobStatus;
  attemptCount: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface IngestionJobRow {
  id: string;
  thread_id: string;
  task_id: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string;
  reason: string;
  status: string;
  attempt_count: number;
  error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function rowToJob(row: IngestionJobRow): IngestionJob {
  return {
    id: row.id,
    threadId: row.thread_id,
    taskId: row.task_id,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
    reason: row.reason as IngestionJobReason,
    status: row.status as IngestionJobStatus,
    attemptCount: row.attempt_count,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export interface EnqueueIngestionJobInput {
  threadId: string;
  sourceEndMessageId: string;
  sourceStartMessageId?: string | null;
  taskId?: string | null;
  reason?: IngestionJobReason;
  now?: number;
}

export function enqueueIngestionJob(input: EnqueueIngestionJobInput): IngestionJob | null {
  ensureFactSchema();
  const db = getMemoryDb();
  const now = input.now ?? Date.now();
  const threadId = input.threadId.trim();
  const sourceEndMessageId = input.sourceEndMessageId.trim();
  if (!threadId || !sourceEndMessageId) return null;

  const duplicate = db.getFirstSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs
       WHERE thread_id = ?
         AND source_end_message_id = ?
         AND status IN ('pending', 'processing')
       LIMIT 1`,
    threadId,
    sourceEndMessageId,
  );
  if (duplicate) return rowToJob(duplicate);

  const id = newId('ingest');
  db.runSync(
    `INSERT INTO memory_ingestion_jobs
       (id, thread_id, task_id, source_start_message_id, source_end_message_id,
        reason, status, attempt_count, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)`,
    id,
    threadId,
    input.taskId ?? null,
    input.sourceStartMessageId ?? null,
    sourceEndMessageId,
    input.reason ?? 'turn_completed',
    now,
    now,
  );
  return rowToJob({
    id,
    thread_id: threadId,
    task_id: input.taskId ?? null,
    source_start_message_id: input.sourceStartMessageId ?? null,
    source_end_message_id: sourceEndMessageId,
    reason: input.reason ?? 'turn_completed',
    status: 'pending',
    attempt_count: 0,
    error: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  });
}

export function countPendingIngestionJobs(): number {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM memory_ingestion_jobs WHERE status = 'pending'`,
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
        AND status = 'completed'`,
    trimmed,
  );
  return Math.max(0, row?.count ?? 0);
}

export function listPendingIngestionJobs(limit = INGESTION_BATCH_LIMIT): IngestionJob[] {
  ensureFactSchema();
  const rows = getMemoryDb().getAllSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
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

function markJobProcessing(jobId: string, now: number): void {
  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           updated_at = ?
     WHERE id = ?`,
    now,
    jobId,
  );
}

function markJobCompleted(jobId: string, now: number): void {
  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = 'completed',
           completed_at = ?,
           updated_at = ?,
           error = NULL
     WHERE id = ?`,
    now,
    now,
    jobId,
  );
}

function markJobFailed(jobId: string, error: string, now: number): void {
  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
       SET status = CASE WHEN attempt_count >= ? THEN 'failed' ELSE 'pending' END,
           error = ?,
           updated_at = ?
     WHERE id = ?`,
    MAX_INGESTION_ATTEMPTS,
    error.slice(0, 500),
    now,
    jobId,
  );
}

function preserveThreadTitleFocus(input: {
  threadId: string;
  threadTitle?: string;
  now: number;
}): void {
  const threadId = input.threadId.trim();
  const threadTitle = input.threadTitle?.trim();
  if (!threadId || !threadTitle) {
    return;
  }

  const scope = { conversationId: threadId, threadId };
  const existing = getWorkingBlock('active_focus', scope)?.content;
  const content = composeActiveFocusContent({
    threadTitle,
    activeFocus: existing,
  });
  if (content && content !== existing?.trim()) {
    editWorkingBlock('active_focus', content, scope, { now: input.now });
  }
}

export interface ProcessIngestionJobInput {
  jobId: string;
  messages: Message[];
  threadTitle?: string;
  personaSummary?: string;
  activeChatProvider?: LlmProviderConfig;
  graphGoalEvidence?: string[];
  sourceRunId?: string;
  now?: number;
}

export async function processIngestionJob(
  input: ProcessIngestionJobInput,
): Promise<{ processed: boolean; skipped?: string }> {
  const job = getIngestionJob(input.jobId);
  if (!job || job.status === 'completed' || job.status === 'failed') {
    return { processed: false, skipped: 'missing_or_terminal' };
  }
  if (shouldAbortIngestionDueToMemoryPressure()) {
    return { processed: false, skipped: 'memory_pressure' };
  }
  if (!acquireIngestionSlot(job.id)) {
    return { processed: false, skipped: 'slot_unavailable' };
  }

  const now = input.now ?? Date.now();
  markJobProcessing(job.id, now);

  try {
    await runConsolidation({
      threadId: job.threadId,
      messages: input.messages,
      threadTitle: input.threadTitle,
      personaSummary: input.personaSummary,
      activeChatProvider: input.activeChatProvider,
      taskId: job.taskId ?? undefined,
      graphGoalEvidence: input.graphGoalEvidence,
      sourceRunId: input.sourceRunId,
      now,
      skipWorkingMemorySync: true,
    });
    preserveThreadTitleFocus({
      threadId: job.threadId,
      threadTitle: input.threadTitle,
      now,
    });
    markJobCompleted(job.id, now);
    refreshThreadReflection({
      threadId: job.threadId,
      taskId: job.taskId,
      now,
    });
    return { processed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.devWarn(`Ingestion job ${job.id} failed:`, message);
    markJobFailed(job.id, message, now);
    return { processed: false, skipped: 'error' };
  } finally {
    releaseIngestionSlot(job.id);
  }
}

export interface GraphGoalEvidenceContext {
  evidence: string[];
  sourceRunId?: string;
  taskId?: string;
}

export interface DrainIngestionQueueInput {
  loadMessagesForThread: (threadId: string) => Message[];
  loadGraphGoalEvidenceForThread?: (threadId: string) => GraphGoalEvidenceContext;
  activeChatProvider?: LlmProviderConfig;
  threadTitle?: string;
  maxJobs?: number;
  now?: number;
}

export interface DrainIngestionQueueResult {
  attempted: number;
  completed: number;
  deferred: number;
  failed: number;
}

export async function drainIngestionQueue(
  input: DrainIngestionQueueInput,
): Promise<DrainIngestionQueueResult> {
  const result: DrainIngestionQueueResult = {
    attempted: 0,
    completed: 0,
    deferred: 0,
    failed: 0,
  };

  const jobs = listPendingIngestionJobs(input.maxJobs ?? INGESTION_BATCH_LIMIT);
  for (const job of jobs) {
    result.attempted += 1;
    const messages = input.loadMessagesForThread(job.threadId);
    if (messages.length === 0) {
      result.deferred += 1;
      continue;
    }
    const graphContext = input.loadGraphGoalEvidenceForThread?.(job.threadId);
    const processed = await processIngestionJob({
      jobId: job.id,
      messages,
      threadTitle: input.threadTitle,
      activeChatProvider: input.activeChatProvider,
      graphGoalEvidence: graphContext?.evidence,
      sourceRunId: graphContext?.sourceRunId,
      now: input.now,
    });
    if (processed.processed) {
      result.completed += 1;
    } else if (processed.skipped === 'error') {
      result.failed += 1;
    } else {
      result.deferred += 1;
    }
  }

  return result;
}

let drainScheduled = false;

export function scheduleIngestionDrain(
  loadMessagesForThread: (threadId: string) => Message[],
  loadGraphGoalEvidenceForThread?: (threadId: string) => GraphGoalEvidenceContext,
  activeChatProvider?: LlmProviderConfig,
  threadTitle?: string,
): void {
  if (drainScheduled) return;
  drainScheduled = true;
  queueMicrotask(() => {
    drainScheduled = false;
    void drainIngestionQueue({
      loadMessagesForThread,
      loadGraphGoalEvidenceForThread,
      activeChatProvider,
      threadTitle,
    }).catch((error) => {
      logger.devWarn(
        'Ingestion drain failed:',
        error instanceof Error ? error.message : String(error),
      );
    });
  });
}

export function __resetIngestionQueueForTests(): void {
  drainScheduled = false;
}
