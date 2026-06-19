// ---------------------------------------------------------------------------
// Kavi — Episode Recall
// ---------------------------------------------------------------------------
// Language-agnostic retrieval of recent episodes for prompt assembly.
// Simple recency-based retrieval. Episodes are already ranked by importance
// at creation time; we just fetch the most recent ones for the current thread.
// ---------------------------------------------------------------------------

import { ensureFactSchema } from './schema';
import { getMemoryDb } from './sqlite-store';
import type { MemoryEpisode } from './episodes/types';

export interface RecallEpisodesOptions {
  threadId?: string;
  conversationId?: string;
  taskId?: string;
  limit?: number;
  maxAgeMs?: number;
}

export function recallRecentEpisodes(options: RecallEpisodesOptions = {}): MemoryEpisode[] {
  ensureFactSchema();
  const clauses: string[] = ['deleted_at IS NULL'];
  const params: Array<string | number> = [];

  if (options.threadId) {
    clauses.push('thread_id = ?');
    params.push(options.threadId);
  } else if (options.conversationId) {
    clauses.push('conversation_id = ?');
    params.push(options.conversationId);
  }

  if (options.taskId) {
    clauses.push('task_id = ?');
    params.push(options.taskId);
  }

  if (typeof options.maxAgeMs === 'number' && options.maxAgeMs > 0) {
    clauses.push('ended_at > ?');
    params.push(Date.now() - options.maxAgeMs);
  }

  const limit = Math.max(1, Math.min(options.limit ?? 6, 20));
  const where = clauses.join(' AND ');

  interface EpisodeRow {
    id: string;
    conversation_id: string | null;
    thread_id: string | null;
    task_id: string | null;
    started_at: number;
    ended_at: number;
    summary: string;
    entities_json: string;
    message_ids_json: string;
    tool_names_json: string;
    importance: number;
    embedding: string | null;
    created_at: number;
    deleted_at: number | null;
    source_start_message_id: string | null;
    source_end_message_id: string | null;
  }

  const rows = getMemoryDb().getAllSync<EpisodeRow>(
    `SELECT * FROM memory_episodes
       WHERE ${where}
       ORDER BY ended_at DESC
       LIMIT ${limit}`,
    ...params,
  );

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    threadId: row.thread_id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    summary: row.summary,
    entities: safeParseJsonArray<string>(row.entities_json),
    messageIds: safeParseJsonArray<string>(row.message_ids_json),
    toolNames: safeParseJsonArray<string>(row.tool_names_json),
    importance: row.importance,
    embedding: parseEmbedding(row.embedding),
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  }));
}

function safeParseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : null;
  } catch {
    return null;
  }
}
