// ---------------------------------------------------------------------------
// Kavi — Memory task segmentation
// ---------------------------------------------------------------------------
// Durable task/topic rows for one canonical conversation. Tasks are explicit
// structural segments — never inferred from natural-language patterns.
// ---------------------------------------------------------------------------

import { getMany, getOne } from './access/crud';
import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { canWriteLongTermMemory } from './policy';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import {
  advanceMemoryProjectionInTransaction,
  advanceRestrictiveMemoryAuthorityInTransaction,
} from './memoryAuthority';

export type MemoryTaskState = 'active' | 'paused' | 'completed';

export interface MemoryTask {
  id: string;
  threadId: string;
  title: string;
  state: MemoryTaskState;
  startedAt: number;
  lastActiveAt: number;
  endedAt: number | null;
  parentTaskId: string | null;
  summary: string | null;
  embedding: number[] | null;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface TaskRow {
  id: string;
  thread_id: string;
  title: string;
  state: string;
  started_at: number;
  last_active_at: number;
  ended_at: number | null;
  parent_task_id: string | null;
  summary: string | null;
  embedding: string | null;
  confidence: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

function rowToTask(row: TaskRow): MemoryTask {
  return {
    id: row.id,
    threadId: row.thread_id,
    title: row.title,
    state: normalizeTaskState(row.state),
    startedAt: row.started_at,
    lastActiveAt: row.last_active_at,
    endedAt: row.ended_at,
    parentTaskId: row.parent_task_id,
    summary: row.summary,
    embedding: parseEmbedding(row.embedding),
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function normalizeTaskState(value: unknown): MemoryTaskState {
  if (value === 'active' || value === 'paused' || value === 'completed') return value;
  return 'active';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export interface UpsertMemoryTaskInput {
  id: string;
  threadId: string;
  title: string;
  state?: MemoryTaskState;
  parentTaskId?: string | null;
  summary?: string | null;
  embedding?: number[] | null;
  confidence?: number;
  now?: number;
}

export function upsertMemoryTask(input: UpsertMemoryTaskInput): MemoryTask {
  return runMemoryTransaction(() => upsertMemoryTaskInTransaction(input));
}

function upsertMemoryTaskInTransaction(input: UpsertMemoryTaskInput): MemoryTask {
  if (!canWriteLongTermMemory()) throw new Error('memory_disabled');
  const db = getSchemaReadyMemoryDb();
  const now = input.now ?? Date.now();
  const id = input.id.trim();
  const threadId = input.threadId.trim();
  const title = input.title.trim();
  if (!id || !threadId || !title) {
    throw new Error('upsertMemoryTask: id, threadId, and title are required');
  }

  const existing = db.getFirstSync<TaskRow>(
    `SELECT * FROM memory_tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    id,
  );

  const state = normalizeTaskState(input.state ?? existing?.state ?? 'active');
  const endedAt = state === 'completed' ? (existing?.ended_at ?? now) : null;

  if (existing) {
    if (existing.thread_id !== threadId) {
      throw new Error('memory_task_thread_identity_conflict');
    }
    const nextParentTaskId = input.parentTaskId ?? existing.parent_task_id;
    const nextSummary = input.summary ?? existing.summary;
    const nextEmbedding = input.embedding ? JSON.stringify(input.embedding) : existing.embedding;
    const nextConfidence = clamp01(input.confidence ?? existing.confidence);
    const embeddingChanged = nextEmbedding !== existing.embedding;
    const confidenceChanged = nextConfidence !== existing.confidence;
    const restrictiveProjectionChanged =
      existing.title !== title ||
      existing.state !== state ||
      existing.parent_task_id !== nextParentTaskId ||
      existing.summary !== nextSummary ||
      (embeddingChanged && existing.embedding !== null) ||
      nextConfidence < existing.confidence;
    const additiveProjectionChanged =
      (embeddingChanged && existing.embedding === null) ||
      (confidenceChanged && nextConfidence > existing.confidence);
    db.runSync(
      `UPDATE memory_tasks
         SET title = ?,
             state = ?,
             last_active_at = ?,
             ended_at = ?,
             parent_task_id = COALESCE(?, parent_task_id),
             summary = COALESCE(?, summary),
             embedding = COALESCE(?, embedding),
             confidence = ?,
             updated_at = ?
       WHERE id = ?`,
      title,
      state,
      now,
      endedAt,
      input.parentTaskId ?? null,
      input.summary ?? null,
      input.embedding ? JSON.stringify(input.embedding) : null,
      nextConfidence,
      now,
      id,
    );
    if (restrictiveProjectionChanged) {
      advanceRestrictiveMemoryAuthorityInTransaction(db, getLocalMemoryVaultOwnerId(db));
    } else if (additiveProjectionChanged) {
      advanceMemoryProjectionInTransaction(db, getLocalMemoryVaultOwnerId(db));
    }
    runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged(threadId));
    return rowToTask({
      ...existing,
      title,
      state,
      last_active_at: now,
      ended_at: endedAt,
      parent_task_id: nextParentTaskId,
      summary: nextSummary,
      embedding: nextEmbedding,
      confidence: nextConfidence,
      updated_at: now,
    });
  }

  db.runSync(
    `INSERT INTO memory_tasks
       (id, thread_id, title, state, started_at, last_active_at, ended_at,
        parent_task_id, summary, embedding, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    threadId,
    title,
    state,
    now,
    now,
    endedAt,
    input.parentTaskId ?? null,
    input.summary ?? null,
    input.embedding ? JSON.stringify(input.embedding) : null,
    clamp01(input.confidence ?? 0.5),
    now,
    now,
  );
  advanceMemoryProjectionInTransaction(db, getLocalMemoryVaultOwnerId(db));
  runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged(threadId));
  return {
    id,
    threadId,
    title,
    state,
    startedAt: now,
    lastActiveAt: now,
    endedAt,
    parentTaskId: input.parentTaskId ?? null,
    summary: input.summary ?? null,
    embedding: input.embedding ?? null,
    confidence: clamp01(input.confidence ?? 0.5),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function getMemoryTask(taskId: string): MemoryTask | null {
  const row = getOne<TaskRow>(
    `SELECT * FROM memory_tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    taskId.trim(),
  );
  return row ? rowToTask(row) : null;
}

export function getLatestActiveMemoryTask(): MemoryTask | null {
  const row = getOne<TaskRow>(
    `SELECT * FROM memory_tasks
       WHERE state = 'active'
         AND deleted_at IS NULL
       ORDER BY last_active_at DESC
       LIMIT 1`,
  );
  return row ? rowToTask(row) : null;
}

export function getActiveMemoryTask(threadId: string): MemoryTask | null {
  const row = getOne<TaskRow>(
    `SELECT * FROM memory_tasks
       WHERE thread_id = ?
         AND state = 'active'
         AND deleted_at IS NULL
       ORDER BY last_active_at DESC
       LIMIT 1`,
    threadId.trim(),
  );
  return row ? rowToTask(row) : null;
}

export function listMemoryTasks(
  threadId: string,
  options: { limit?: number; includeCompleted?: boolean } = {},
): MemoryTask[] {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const rows = options.includeCompleted
    ? getMany<TaskRow>(
        `SELECT * FROM memory_tasks
           WHERE thread_id = ? AND deleted_at IS NULL
           ORDER BY last_active_at DESC
           LIMIT ?`,
        threadId.trim(),
        limit,
      )
    : getMany<TaskRow>(
        `SELECT * FROM memory_tasks
           WHERE thread_id = ?
             AND state != 'completed'
             AND deleted_at IS NULL
           ORDER BY last_active_at DESC
           LIMIT ?`,
        threadId.trim(),
        limit,
      );
  return rows.map(rowToTask);
}
