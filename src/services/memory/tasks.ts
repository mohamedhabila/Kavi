// ---------------------------------------------------------------------------
// Kavi — Memory task segmentation
// ---------------------------------------------------------------------------
// Durable task/topic rows for one canonical conversation. Tasks are explicit
// structural segments (graph goal ids, tool-driven updates) — never inferred
// from natural-language patterns.
// ---------------------------------------------------------------------------

import type { AgentGoal, AgentGoalMutation } from '../../engine/goals/types';
import { getActiveGoal, getGoalById } from '../../engine/goals/types';
import { getMany, getOne, runMemoryStatement } from './access/crud';
import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { notifyStructuredMemoryChanged } from './store';
import { upsertGoalTaskEntry } from './taskStack';
import { editWorkingBlock } from './workingBlocks';

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
      clamp01(input.confidence ?? existing.confidence),
      now,
      id,
    );
    notifyStructuredMemoryChanged(threadId);
    return rowToTask({
      ...existing,
      title,
      state,
      last_active_at: now,
      ended_at: endedAt,
      summary: input.summary ?? existing.summary,
      embedding: input.embedding ? JSON.stringify(input.embedding) : existing.embedding,
      confidence: clamp01(input.confidence ?? existing.confidence),
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
  notifyStructuredMemoryChanged(threadId);
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

function mapGoalStatusToTaskState(status: AgentGoal['status']): MemoryTaskState {
  if (status === 'active') return 'active';
  if (status === 'completed') return 'completed';
  return 'paused';
}

function resolveMutationGoal(
  patch: AgentGoalMutation['goals'][number],
  goals: ReadonlyArray<AgentGoal>,
): AgentGoal | null {
  const id = patch.id?.trim();
  if (id) return getGoalById(goals, id);
  const title = patch.title?.trim();
  if (title) return goals.find((goal) => goal.title === title) ?? null;
  return null;
}

function syncGoalTaskEntry(threadId: string, goal: AgentGoal, now: number): void {
  const state = mapGoalStatusToTaskState(goal.status);
  upsertGoalTaskEntry(threadId, goal.id, goal.title, state, now);
  upsertMemoryTask({
    id: goal.id,
    threadId,
    title: goal.title,
    state,
    now,
  });
}

/**
 * Mirror graph goal mutations into memory_tasks and the task_stack working block.
 * Structural only — goal ids/titles come from update_goals, never from NL parsing.
 */
export function syncGoalTasksFromMutation(params: {
  threadId: string;
  mutation: AgentGoalMutation;
  goals: ReadonlyArray<AgentGoal>;
  now?: number;
}): void {
  const threadId = params.threadId.trim();
  if (!threadId) return;
  const now = params.now ?? Date.now();

  for (const patch of params.mutation.goals) {
    const goal = resolveMutationGoal(patch, params.goals);
    if (!goal) continue;
    syncGoalTaskEntry(threadId, goal, now);
  }

  const activeGoal = getActiveGoal(params.goals);
  if (!activeGoal) return;

  upsertGoalTaskEntry(threadId, activeGoal.id, activeGoal.title, 'active', now);
  syncActiveTaskFromGoal({
    threadId,
    goalId: activeGoal.id,
    goalTitle: activeGoal.title,
    now,
  });
}

export function syncActiveGoalFocusFromGraphTransition(params: {
  threadId: string;
  goals: ReadonlyArray<AgentGoal>;
  now?: number;
}): void {
  const activeGoal = getActiveGoal(params.goals);
  if (!activeGoal) {
    return;
  }

  syncActiveTaskFromGoal({
    threadId: params.threadId,
    goalId: activeGoal.id,
    goalTitle: activeGoal.title,
    now: params.now,
  });
}

export function syncActiveTaskFromGoal(params: {
  threadId: string;
  goalId: string;
  goalTitle: string;
  threadTitle?: string;
  now?: number;
}): MemoryTask {
  const pausedTasks = listMemoryTasks(params.threadId, { includeCompleted: false });
  const now = params.now ?? Date.now();

  for (const task of pausedTasks) {
    if (task.id === params.goalId || task.state !== 'active') continue;
    runMemoryStatement(
      `UPDATE memory_tasks SET state = 'paused', last_active_at = ?, updated_at = ? WHERE id = ?`,
      now,
      now,
      task.id,
    );
  }

  const task = upsertMemoryTask({
    id: params.goalId,
    threadId: params.threadId,
    title: params.goalTitle,
    state: 'active',
    now,
  });

  const focusContent = buildActiveGoalFocusContent(params.goalTitle, params.threadTitle);
  if (focusContent) {
    editWorkingBlock(
      'active_focus',
      focusContent,
      {
        conversationId: params.threadId,
        threadId: params.threadId,
        taskId: params.goalId,
      },
      { now },
    );
  }

  return task;
}

function buildActiveGoalFocusContent(goalTitle: string, threadTitle?: string): string {
  const normalizedGoalTitle = goalTitle.trim();
  const normalizedThreadTitle = threadTitle?.trim() ?? '';
  if (!normalizedGoalTitle) return normalizedThreadTitle;
  if (!normalizedThreadTitle || normalizedThreadTitle === normalizedGoalTitle) {
    return normalizedGoalTitle;
  }
  return `${normalizedGoalTitle}\n${normalizedThreadTitle}`;
}
