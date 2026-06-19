// ---------------------------------------------------------------------------
// Kavi — Retrieval Log
// ---------------------------------------------------------------------------
// Simple audit trail of what memory was retrieved for each prompt assembly.
// No complex analytics. Just accountability and debugging.
//
// Design:
//   - One row per retrieval event (per turn)
//   - Stores fact IDs and episode IDs as JSON arrays
//   - Token estimate helps debug prompt bloat
//   - Auto-pruned to last 500 entries to prevent unbounded growth
//
// Human-memory analogy: this is like being able to answer "what were you
// thinking about just now?" — not the full reasoning trace, just the
// working-memory contents that were active.
// ---------------------------------------------------------------------------

import { ensureFactSchema } from './schema';
import { getMemoryDb } from './sqlite-store';

const RETENTION_LIMIT = 500;

export interface RetrievalLogEntry {
  id: string;
  threadId: string | null;
  taskId: string | null;
  query: string;
  factIds: string[];
  episodeIds: string[];
  tokenEstimate: number;
  createdAt: number;
}

export interface LogRetrievalInput {
  threadId?: string | null;
  taskId?: string | null;
  query: string;
  factIds: string[];
  episodeIds: string[];
  tokenEstimate: number;
}

function ensureTable(): void {
  ensureFactSchema();
  getMemoryDb().execSync(`
    CREATE TABLE IF NOT EXISTS memory_retrieval_log (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      task_id TEXT,
      query TEXT NOT NULL DEFAULT '',
      fact_ids_json TEXT NOT NULL DEFAULT '[]',
      episode_ids_json TEXT NOT NULL DEFAULT '[]',
      token_estimate INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_retrieval_log_thread
      ON memory_retrieval_log(thread_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_retrieval_log_created
      ON memory_retrieval_log(created_at DESC);
  `);
}

function pruneOldEntries(): void {
  try {
    getMemoryDb().runSync(
      `DELETE FROM memory_retrieval_log
       WHERE id NOT IN (
         SELECT id FROM memory_retrieval_log
         ORDER BY created_at DESC
         LIMIT ?
       )`,
      RETENTION_LIMIT,
    );
  } catch {
    // Pruning is best-effort; never break the retrieval path
  }
}

/**
 * Log a retrieval event. Best-effort: never throws.
 */
export function logRetrieval(input: LogRetrievalInput): void {
  try {
    ensureTable();
    const now = Date.now();
    const id = `rl_${now}_${Math.random().toString(36).slice(2, 8)}`;
    getMemoryDb().runSync(
      `INSERT INTO memory_retrieval_log
         (id, thread_id, task_id, query, fact_ids_json, episode_ids_json, token_estimate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.threadId ?? null,
      input.taskId ?? null,
      input.query.slice(0, 500),
      JSON.stringify(input.factIds.slice(0, 50)),
      JSON.stringify(input.episodeIds.slice(0, 50)),
      Math.max(0, input.tokenEstimate),
      now,
    );
    pruneOldEntries();
  } catch {
    // Logging is best-effort; never break the prompt assembly path
  }
}

export interface ReadRetrievalsOptions {
  threadId?: string;
  limit?: number;
}

/**
 * Read recent retrieval log entries. Returns empty array on any error.
 */
export function readRecentRetrievals(options: ReadRetrievalsOptions = {}): RetrievalLogEntry[] {
  try {
    ensureTable();
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const rows = options.threadId
      ? getMemoryDb().getAllSync<{
          id: string;
          thread_id: string | null;
          task_id: string | null;
          query: string;
          fact_ids_json: string;
          episode_ids_json: string;
          token_estimate: number;
          created_at: number;
        }>(
          `SELECT * FROM memory_retrieval_log
           WHERE thread_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
          options.threadId,
          limit,
        )
      : getMemoryDb().getAllSync<{
          id: string;
          thread_id: string | null;
          task_id: string | null;
          query: string;
          fact_ids_json: string;
          episode_ids_json: string;
          token_estimate: number;
          created_at: number;
        }>(
          `SELECT * FROM memory_retrieval_log
           ORDER BY created_at DESC
           LIMIT ?`,
          limit,
        );

    return rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      taskId: row.task_id,
      query: row.query,
      factIds: safeParseJsonArray(row.fact_ids_json),
      episodeIds: safeParseJsonArray(row.episode_ids_json),
      tokenEstimate: row.token_estimate,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
