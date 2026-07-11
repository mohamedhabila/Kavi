import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import { withImmediateTransaction } from './mutationStore';
import { EXECUTION_DURABILITY_CLASSES, type ExecutionDurabilityClass } from './types';

export const TERMINAL_EXECUTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_RETAINED_TERMINAL_EXECUTION_RUNS = 5_000;
export const MAX_TERMINAL_EXECUTION_PRUNE_BATCH = 500;

export interface TerminalExecutionRetentionInput {
  now: number;
  durabilityClass: ExecutionDurabilityClass;
  maxAgeMs?: number;
  maxRetained?: number;
  limit?: number;
  getDatabase?: () => SQLite.SQLiteDatabase;
}

function requireBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`execution_journal_retention_invalid_${label}`);
  }
  return value;
}

function requireDurabilityClass(value: unknown): ExecutionDurabilityClass {
  if (!EXECUTION_DURABILITY_CLASSES.includes(value as ExecutionDurabilityClass)) {
    throw new Error('execution_journal_retention_invalid_durability_class');
  }
  return value as ExecutionDurabilityClass;
}

function selectTerminalRunIds(
  database: SQLite.SQLiteDatabase,
  durabilityClass: ExecutionDurabilityClass,
  terminalBefore: number | null,
  limit: number,
): string[] {
  const cutoff = terminalBefore === null ? '' : 'AND terminal_at < ?';
  const parameters: SQLite.SQLiteBindValue[] = [durabilityClass];
  if (terminalBefore !== null) parameters.push(terminalBefore);
  return database
    .getAllSync<{ id: string }>(
      `SELECT id FROM execution_runs
       WHERE durability_class = ?
         AND status IN ('succeeded', 'failed', 'cancelled')
         AND terminal_at IS NOT NULL
         ${cutoff}
       ORDER BY terminal_at ASC, id ASC
       LIMIT ?`,
      ...parameters,
      limit,
    )
    .map((row) => row.id);
}

function deleteTerminalRunIds(
  database: SQLite.SQLiteDatabase,
  durabilityClass: ExecutionDurabilityClass,
  runIds: readonly string[],
): number {
  let deleted = 0;
  for (const runId of runIds) {
    const result = database.runSync(
      `DELETE FROM execution_runs
       WHERE id = ?
         AND durability_class = ?
         AND status IN ('succeeded', 'failed', 'cancelled')`,
      runId,
      durabilityClass,
    );
    deleted += result.changes;
  }
  return deleted;
}

/** Remove one bounded age/overflow slice for any explicitly selected durability class. */
export function maintainTerminalExecutionRetention(input: TerminalExecutionRetentionInput): number {
  const now = requireBoundedInteger(input.now, 0, Number.MAX_SAFE_INTEGER, 'clock');
  const durabilityClass = requireDurabilityClass(input.durabilityClass);
  const maxAgeMs = requireBoundedInteger(
    input.maxAgeMs ?? TERMINAL_EXECUTION_RETENTION_MS,
    1,
    Number.MAX_SAFE_INTEGER,
    'max_age',
  );
  const maxRetained = requireBoundedInteger(
    input.maxRetained ?? MAX_RETAINED_TERMINAL_EXECUTION_RUNS,
    1,
    100_000,
    'max_retained',
  );
  const limit = requireBoundedInteger(
    input.limit ?? MAX_TERMINAL_EXECUTION_PRUNE_BATCH,
    1,
    1_000,
    'limit',
  );
  const cutoff = Math.max(0, now - maxAgeMs);
  const database = (input.getDatabase ?? getExecutionJournalDb)();

  return withImmediateTransaction(database, () => {
    const agedIds = selectTerminalRunIds(database, durabilityClass, cutoff, limit);
    let deleted = deleteTerminalRunIds(database, durabilityClass, agedIds);
    const remainingLimit = limit - deleted;
    if (remainingLimit <= 0) return deleted;

    const count = database.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM execution_runs
       WHERE durability_class = ?
         AND status IN ('succeeded', 'failed', 'cancelled')`,
      durabilityClass,
    )?.count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('execution_journal_retention_invalid_count');
    }
    const overflow = Math.max(0, count - maxRetained);
    if (overflow === 0) return deleted;
    const overflowIds = selectTerminalRunIds(
      database,
      durabilityClass,
      null,
      Math.min(overflow, remainingLimit),
    );
    deleted += deleteTerminalRunIds(database, durabilityClass, overflowIds);
    return deleted;
  });
}

/** Drain through bounded transactions until the selected terminal policy is satisfied. */
export function maintainAllTerminalExecutionRetention(
  input: TerminalExecutionRetentionInput,
): number {
  const limit = input.limit ?? MAX_TERMINAL_EXECUTION_PRUNE_BATCH;
  requireBoundedInteger(limit, 1, 1_000, 'limit');
  let deleted = 0;
  while (true) {
    const passDeleted = maintainTerminalExecutionRetention({ ...input, limit });
    deleted += passDeleted;
    if (passDeleted < limit) return deleted;
  }
}
