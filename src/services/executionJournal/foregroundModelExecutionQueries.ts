import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import { decodeExecutionCheckpointRow, decodeExecutionRunRow } from './decoders';
import {
  FOREGROUND_MODEL_ACTIVE_RUN_STATUSES,
  type ForegroundModelExecutionLease,
  type ForegroundModelExecutionLifecycle,
  type ListPendingForegroundModelExecutionsInput,
} from './foregroundModelExecutionTypes';

const MAX_PENDING_FOREGROUND_MODEL_RUNS = 64;

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function toLease(
  run: ReturnType<typeof decodeExecutionRunRow>,
  checkpoint: ReturnType<typeof decodeExecutionCheckpointRow>,
): ForegroundModelExecutionLease {
  return {
    runId: run.id,
    conversationId: run.conversationId,
    requestMessageId: run.requestMessageId,
    assistantMessageId: checkpoint.stateRefId,
    taskId: run.taskId,
    createdAt: run.createdAt,
    expectedStatus: run.status,
    controlEpoch: run.controlEpoch,
    updatedAt: run.updatedAt,
    checkpointId: checkpoint.id,
    checkpointStateDigest: checkpoint.stateDigest,
  };
}

/** List one bounded, cursor-addressable page of interrupted foreground generations. */
export function listPendingForegroundModelExecutions(
  input: ListPendingForegroundModelExecutionsInput = {},
  options: { getDatabase?: () => SQLite.SQLiteDatabase } = {},
): ForegroundModelExecutionLease[] {
  const limit = input.limit ?? 32;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PENDING_FOREGROUND_MODEL_RUNS) {
    throw new Error('foreground_model_journal_invalid_limit');
  }
  if (input.after && (!validTimestamp(input.after.createdAt) || !validId(input.after.runId))) {
    throw new Error('foreground_model_journal_invalid_cursor');
  }
  const database = (options.getDatabase ?? getExecutionJournalDb)();
  const placeholders = FOREGROUND_MODEL_ACTIVE_RUN_STATUSES.map(() => '?').join(', ');
  const cursorClause = input.after ? 'AND (created_at > ? OR (created_at = ? AND id > ?))' : '';
  const cursorParams = input.after
    ? [input.after.createdAt, input.after.createdAt, input.after.runId]
    : [];
  const rows = database.getAllSync<unknown>(
    `SELECT * FROM execution_runs
     WHERE durability_class = 'foreground_interactive'
       AND execution_surface = 'model'
       AND resume_strategy = 'not_resumable'
       AND status IN (${placeholders})
       ${cursorClause}
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    ...FOREGROUND_MODEL_ACTIVE_RUN_STATUSES,
    ...cursorParams,
    limit,
  );
  return rows.map((rawRun) => {
    const run = decodeExecutionRunRow(rawRun);
    const rawCheckpoint = database.getFirstSync<unknown>(
      `SELECT * FROM execution_checkpoints
       WHERE run_id = ? ORDER BY sequence DESC, id ASC LIMIT 1`,
      run.id,
    );
    if (!rawCheckpoint) throw new Error('foreground_model_journal_history_missing');
    return toLease(run, decodeExecutionCheckpointRow(rawCheckpoint));
  });
}

export function inspectForegroundModelExecutionLifecycle(
  runId: string,
  options: { getDatabase?: () => SQLite.SQLiteDatabase } = {},
): ForegroundModelExecutionLifecycle {
  if (!validId(runId)) throw new Error('foreground_model_journal_invalid_run_id');
  const database = (options.getDatabase ?? getExecutionJournalDb)();
  const raw = database.getFirstSync<unknown>('SELECT * FROM execution_runs WHERE id = ?', runId);
  if (!raw) return 'missing';
  const run = decodeExecutionRunRow(raw);
  if (
    run.durabilityClass !== 'foreground_interactive' ||
    run.executionSurface !== 'model' ||
    run.resumeStrategy !== 'not_resumable'
  ) {
    return 'not_foreground_model';
  }
  return FOREGROUND_MODEL_ACTIVE_RUN_STATUSES.includes(
    run.status as (typeof FOREGROUND_MODEL_ACTIVE_RUN_STATUSES)[number],
  )
    ? 'active'
    : 'terminal';
}
