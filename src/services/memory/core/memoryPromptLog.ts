// ---------------------------------------------------------------------------
// Kavi — What each request's memory section held
// ---------------------------------------------------------------------------
// One row per prompt build: the memory and past-turn ids it placed in front of the model,
// its size and how long it took. Ids and numbers only, never text, so the log adds no
// privacy surface; it lets a slow or empty recall be investigated from data, and the
// evaluation harness check which memories a turn was shown. Only the latest rows are kept.
// ---------------------------------------------------------------------------

import type * as SQLite from 'expo-sqlite';
import { createLogger } from '../../../utils/logger';
import { getMemoryDb } from '../database';
import { ensureMemoryCoreSchema } from './memorySchema';

const logger = createLogger('memory.prompt-log');

export const MEMORY_PROMPT_LOG_RETAINED_ROWS = 500;

export interface MemoryPromptBuild {
  id: number;
  conversationId: string;
  at: number;
  itemIds: string[];
  turnIds: string[];
  chars: number;
  durationMs: number;
}

interface MemoryPromptBuildRow {
  id: number;
  conversation_id: string;
  at: number;
  item_ids: string;
  turn_ids: string;
  chars: number;
  duration_ms: number;
}

function readyDb(): SQLite.SQLiteDatabase {
  const db = getMemoryDb();
  ensureMemoryCoreSchema(db);
  return db;
}

function parseIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Records one build. A failed write is logged and never fails the request. */
export function recordMemoryPromptBuild(build: Omit<MemoryPromptBuild, 'id'>): void {
  try {
    const db = readyDb();
    const inserted = db.runSync(
      `INSERT INTO memory_prompt_log (conversation_id, at, item_ids, turn_ids, chars, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      build.conversationId,
      build.at,
      JSON.stringify(build.itemIds),
      JSON.stringify(build.turnIds),
      build.chars,
      build.durationMs,
    );
    db.runSync(
      'DELETE FROM memory_prompt_log WHERE id <= ?',
      Number(inserted.lastInsertRowId) - MEMORY_PROMPT_LOG_RETAINED_ROWS,
    );
  } catch (error) {
    logger.warn('Could not record the memory prompt build.', { error: String(error) });
  }
}

/** Builds for `conversationId` after row `afterId`, oldest first. */
export function listMemoryPromptBuilds(params: {
  conversationId: string;
  afterId?: number;
}): MemoryPromptBuild[] {
  return readyDb()
    .getAllSync<MemoryPromptBuildRow>(
      `SELECT id, conversation_id, at, item_ids, turn_ids, chars, duration_ms
         FROM memory_prompt_log
        WHERE conversation_id = ? AND id > ?
        ORDER BY id`,
      params.conversationId,
      params.afterId ?? 0,
    )
    .map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      at: row.at,
      itemIds: parseIds(row.item_ids),
      turnIds: parseIds(row.turn_ids),
      chars: row.chars,
      durationMs: row.duration_ms,
    }));
}

/** The id of the newest build, or 0; a later `listMemoryPromptBuilds` starts after it. */
export function latestMemoryPromptBuildId(): number {
  return (
    readyDb().getFirstSync<{ id: number | null }>('SELECT max(id) AS id FROM memory_prompt_log')
      ?.id ?? 0
  );
}
