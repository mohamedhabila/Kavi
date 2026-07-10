import { getExecutionJournalDb } from './database';
import { decodeExecutionRunRow } from './decoders';
import { RETENTION_DELETABLE_RUN_STATUSES } from './types';

export type TerminalExecutionRunDeletionResult = 'deleted' | 'protected' | 'missing';

const DELETABLE_STATUS_SQL = RETENTION_DELETABLE_RUN_STATUSES.map(() => '?').join(', ');
const DELETABLE_STATUS_VALUES = [...RETENTION_DELETABLE_RUN_STATUSES];
const DELETABLE_STATUS_SET = new Set<string>(RETENTION_DELETABLE_RUN_STATUSES);

function requireRunId(runId: string): string {
  if (
    typeof runId !== 'string' ||
    runId !== runId.trim() ||
    runId.length < 1 ||
    runId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(runId)
  ) {
    throw new Error('execution_journal_invalid_run_id');
  }
  return runId;
}

export function deleteRetainedTerminalExecutionRun(
  runId: string,
): TerminalExecutionRunDeletionResult {
  const id = requireRunId(runId);
  const database = getExecutionJournalDb();
  const raw = database.getFirstSync<unknown>('SELECT * FROM execution_runs WHERE id = ?', id);
  if (!raw) {
    return 'missing';
  }
  const run = decodeExecutionRunRow(raw);
  if (!DELETABLE_STATUS_SET.has(run.status)) {
    return 'protected';
  }
  const result = database.runSync(
    `DELETE FROM execution_runs
     WHERE id = ? AND status IN (${DELETABLE_STATUS_SQL})`,
    id,
    ...DELETABLE_STATUS_VALUES,
  );
  return result.changes === 1 ? 'deleted' : 'protected';
}

export function pruneRetainedTerminalExecutionRuns(input: {
  terminalBefore: number;
  limit: number;
}): number {
  if (!Number.isSafeInteger(input.terminalBefore) || input.terminalBefore < 0) {
    throw new Error('execution_journal_invalid_retention_cutoff');
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
    throw new Error('execution_journal_invalid_retention_limit');
  }

  const database = getExecutionJournalDb();
  database.execSync('BEGIN IMMEDIATE');
  try {
    const rows = database.getAllSync<unknown>(
      `SELECT * FROM execution_runs
       WHERE status IN (${DELETABLE_STATUS_SQL})
         AND terminal_at IS NOT NULL
         AND terminal_at < ?
       ORDER BY terminal_at ASC, id ASC
       LIMIT ?`,
      ...DELETABLE_STATUS_VALUES,
      input.terminalBefore,
      input.limit,
    );
    const runs = rows.map(decodeExecutionRunRow);
    let deleted = 0;
    for (const run of runs) {
      const result = database.runSync(
        `DELETE FROM execution_runs
         WHERE id = ?
           AND status IN (${DELETABLE_STATUS_SQL})
           AND terminal_at IS NOT NULL
           AND terminal_at < ?`,
        run.id,
        ...DELETABLE_STATUS_VALUES,
        input.terminalBefore,
      );
      deleted += result.changes;
    }
    database.execSync('COMMIT');
    return deleted;
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
    } catch {
      // Preserve the original decoder or database error.
    }
    throw error;
  }
}
