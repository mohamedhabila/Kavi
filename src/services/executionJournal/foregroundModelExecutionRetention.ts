import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import { withImmediateTransaction } from './mutationStore';

export const FOREGROUND_MODEL_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_RETAINED_FOREGROUND_MODEL_RUNS = 2_000;
export const MAX_FOREGROUND_MODEL_PRUNE_BATCH = 500;

export interface ForegroundModelRetentionInput {
  now: number;
  maxAgeMs?: number;
  maxRetained?: number;
  limit?: number;
  getDatabase?: () => SQLite.SQLiteDatabase;
}

/** Drain all aged/overflow terminal rows through bounded transactions. */
export function maintainAllForegroundModelExecutionRetention(
  input: ForegroundModelRetentionInput,
): number {
  const limit = input.limit ?? MAX_FOREGROUND_MODEL_PRUNE_BATCH;
  requireBoundedInteger(limit, 1, 1_000, 'limit');
  let deleted = 0;
  while (true) {
    const passDeleted = maintainForegroundModelExecutionRetention({ ...input, limit });
    deleted += passDeleted;
    if (passDeleted < limit) return deleted;
  }
}

function requireBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`foreground_model_retention_invalid_${label}`);
  }
  return value;
}

function selectTerminalRunIds(
  database: SQLite.SQLiteDatabase,
  whereClause: string,
  params: SQLite.SQLiteBindValue[],
  limit: number,
): string[] {
  return database
    .getAllSync<{ id: string }>(
      `SELECT id FROM execution_runs
       WHERE durability_class = 'foreground_interactive'
         AND execution_surface = 'model'
         AND status IN ('succeeded', 'failed', 'cancelled')
         AND terminal_at IS NOT NULL
         AND ${whereClause}
       ORDER BY terminal_at ASC, id ASC
       LIMIT ?`,
      ...params,
      limit,
    )
    .map((row) => row.id);
}

function deleteTerminalRunIds(database: SQLite.SQLiteDatabase, runIds: readonly string[]): number {
  let deleted = 0;
  for (const runId of runIds) {
    const result = database.runSync(
      `DELETE FROM execution_runs
       WHERE id = ?
         AND durability_class = 'foreground_interactive'
         AND execution_surface = 'model'
         AND status IN ('succeeded', 'failed', 'cancelled')`,
      runId,
    );
    deleted += result.changes;
  }
  return deleted;
}

/** Remove aged rows first, then the oldest overflow, without touching active or external runs. */
export function maintainForegroundModelExecutionRetention(
  input: ForegroundModelRetentionInput,
): number {
  const now = requireBoundedInteger(input.now, 0, Number.MAX_SAFE_INTEGER, 'clock');
  const maxAgeMs = requireBoundedInteger(
    input.maxAgeMs ?? FOREGROUND_MODEL_TERMINAL_RETENTION_MS,
    1,
    Number.MAX_SAFE_INTEGER,
    'max_age',
  );
  const maxRetained = requireBoundedInteger(
    input.maxRetained ?? MAX_RETAINED_FOREGROUND_MODEL_RUNS,
    1,
    100_000,
    'max_retained',
  );
  const limit = requireBoundedInteger(
    input.limit ?? MAX_FOREGROUND_MODEL_PRUNE_BATCH,
    1,
    1_000,
    'limit',
  );
  const cutoff = Math.max(0, now - maxAgeMs);
  const database = (input.getDatabase ?? getExecutionJournalDb)();

  return withImmediateTransaction(database, () => {
    const agedIds = selectTerminalRunIds(database, 'terminal_at < ?', [cutoff], limit);
    let deleted = deleteTerminalRunIds(database, agedIds);
    const remainingLimit = limit - deleted;
    if (remainingLimit <= 0) return deleted;

    const count = database.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM execution_runs
       WHERE durability_class = 'foreground_interactive'
         AND execution_surface = 'model'
         AND status IN ('succeeded', 'failed', 'cancelled')`,
    )?.count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('foreground_model_retention_invalid_count');
    }
    const overflow = Math.max(0, count - maxRetained);
    if (overflow === 0) return deleted;
    const overflowIds = selectTerminalRunIds(
      database,
      '1 = 1',
      [],
      Math.min(overflow, remainingLimit),
    );
    deleted += deleteTerminalRunIds(database, overflowIds);
    return deleted;
  });
}
