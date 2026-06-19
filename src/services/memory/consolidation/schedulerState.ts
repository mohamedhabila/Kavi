import { getMany, getOne, runMemoryStatement } from '../access/crud';
import { getSchemaReadyMemoryDb } from '../access/schemaGuard';

export interface ConsolidationStateRow {
  threadId: string;
  lastConsolidatedMessageId: string | null;
  lastConsolidatedAt: number;
  turnsSinceLast: number;
  updatedAt: number;
}

interface ConsolidationStateRowDb {
  thread_id: string;
  last_consolidated_message_id: string | null;
  last_consolidated_at: number;
  turns_since_last: number;
  updated_at: number;
}

function rowToState(row: ConsolidationStateRowDb): ConsolidationStateRow {
  return {
    threadId: row.thread_id,
    lastConsolidatedMessageId: row.last_consolidated_message_id,
    lastConsolidatedAt: row.last_consolidated_at,
    turnsSinceLast: row.turns_since_last,
    updatedAt: row.updated_at,
  };
}

export function getConsolidationState(threadId: string): ConsolidationStateRow | null {
  if (!threadId) return null;
  const row = getOne<ConsolidationStateRowDb>(
    `SELECT * FROM memory_consolidation_state WHERE thread_id = ? LIMIT 1`,
    threadId,
  );
  return row ? rowToState(row) : null;
}

export function listDirtyThreadIds(): string[] {
  const rows = getMany<{ thread_id: string }>(
    `SELECT thread_id FROM memory_consolidation_state WHERE turns_since_last > 0`,
  );
  return rows.map((row) => row.thread_id);
}

export interface UpsertStateInput {
  threadId: string;
  lastConsolidatedMessageId?: string | null;
  lastConsolidatedAt?: number;
  turnsSinceLast?: number;
  now?: number;
}

export function upsertState(input: UpsertStateInput): void {
  const db = getSchemaReadyMemoryDb();
  const now = input.now ?? Date.now();
  const existing = db.getFirstSync<ConsolidationStateRowDb>(
    `SELECT * FROM memory_consolidation_state WHERE thread_id = ? LIMIT 1`,
    input.threadId,
  );
  const lastConsolidatedMessageId =
    input.lastConsolidatedMessageId !== undefined
      ? input.lastConsolidatedMessageId
      : (existing?.last_consolidated_message_id ?? null);
  const lastConsolidatedAt =
    input.lastConsolidatedAt !== undefined
      ? input.lastConsolidatedAt
      : (existing?.last_consolidated_at ?? 0);
  const turnsSinceLast =
    input.turnsSinceLast !== undefined ? input.turnsSinceLast : (existing?.turns_since_last ?? 0);
  if (existing) {
    db.runSync(
      `UPDATE memory_consolidation_state
         SET last_consolidated_message_id = ?,
             last_consolidated_at = ?,
             turns_since_last = ?,
             updated_at = ?
         WHERE thread_id = ?`,
      lastConsolidatedMessageId,
      lastConsolidatedAt,
      turnsSinceLast,
      now,
      input.threadId,
    );
  } else {
    db.runSync(
      `INSERT INTO memory_consolidation_state
         (thread_id, last_consolidated_message_id, last_consolidated_at, turns_since_last, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      input.threadId,
      lastConsolidatedMessageId,
      lastConsolidatedAt,
      turnsSinceLast,
      now,
    );
  }
}

export function clearConsolidationState(threadId: string): void {
  if (!threadId) return;
  runMemoryStatement(`DELETE FROM memory_consolidation_state WHERE thread_id = ?`, threadId);
}
