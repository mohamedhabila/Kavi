import { getExecutionJournalDb } from './database';
import { digestExecutionRecoveryCommand } from './recoveryCoordinator';
import type { ExecutionRecoveryCommand } from './recoveryPlanner';
import { queryExecutionRecovery, type ExecutionRecoveryGeneration } from './recoveryQuery';

const MAX_EXTERNAL_RECOVERY_CANDIDATES = 100;

interface CandidateCursor {
  updatedAt: number;
  runId: string;
}

interface CandidateRow {
  id: string;
  updated_at: number;
}

type CurrentGenerationReceipt =
  | { kind: 'none' }
  | { kind: 'pending'; retryAt: number }
  | { kind: 'blocked' }
  | { kind: 'completed' };

export interface PersistedExternalRecoveryCandidate {
  runId: string;
  generation: ExecutionRecoveryGeneration;
  command: Extract<ExecutionRecoveryCommand, { kind: 'reconcile_external_handles' }>;
  commandDigest: string;
  /** Exact persisted wake time for this generation's pending receipt, when one exists. */
  retryAt: number | null;
}

export interface ListPersistedExternalRecoveryCandidatesInput {
  limit: number;
  after?: string;
}

export type ListPersistedExternalRecoveryCandidatesResult =
  | {
      kind: 'candidates';
      candidates: PersistedExternalRecoveryCandidate[];
      nextAfter: string | null;
    }
  | { kind: 'blocked'; reason: 'invalid_request' | 'journal_unavailable' };

export type ReadPersistedExternalRecoveryCandidateResult =
  | { kind: 'candidate'; candidate: PersistedExternalRecoveryCandidate }
  | { kind: 'not_candidate'; runId: string }
  | { kind: 'blocked'; reason: 'invalid_request' | 'journal_unavailable' };

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function encodeCursor(cursor: CandidateCursor): string {
  return JSON.stringify([cursor.updatedAt, cursor.runId]);
}

function decodeCursor(value: unknown): CandidateCursor | null {
  if (typeof value !== 'string' || value.length > 256) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !validInteger(parsed[0]) ||
      !validId(parsed[1])
    ) {
      return null;
    }
    const cursor = { updatedAt: parsed[0], runId: parsed[1] };
    return encodeCursor(cursor) === value ? cursor : null;
  } catch {
    return null;
  }
}

function validInput(value: unknown): value is ListPersistedExternalRecoveryCandidatesInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(',');
  return (
    (keys === 'limit' || keys === 'after,limit') &&
    Number.isSafeInteger(input.limit) &&
    (input.limit as number) >= 1 &&
    (input.limit as number) <= MAX_EXTERNAL_RECOVERY_CANDIDATES &&
    (input.after === undefined || decodeCursor(input.after) !== null)
  );
}

function decodeRows(value: unknown[]): CandidateRow[] | null {
  const rows: CandidateRow[] = [];
  for (const valueRow of value) {
    if (!valueRow || typeof valueRow !== 'object' || Array.isArray(valueRow)) return null;
    const row = valueRow as Record<string, unknown>;
    if (
      Object.keys(row).sort().join(',') !== 'id,updated_at' ||
      !validId(row.id) ||
      !validInteger(row.updated_at)
    ) {
      return null;
    }
    rows.push({ id: row.id, updated_at: row.updated_at });
  }
  return rows;
}

function readCurrentGenerationReceipt(
  runId: string,
  generation: ExecutionRecoveryGeneration,
): CurrentGenerationReceipt {
  const rows = getExecutionJournalDb().getAllSync<unknown>(
    `SELECT state, retry_at
     FROM execution_recovery_dispatches
     WHERE run_id = ? AND control_epoch = ?
       AND state IN ('completed', 'pending', 'blocked') AND updated_at = ?
     ORDER BY dispatch_id ASC
     LIMIT 2`,
    runId,
    generation.controlEpoch,
    generation.updatedAt,
  );
  if (rows.length === 0) return { kind: 'none' };
  if (rows.length !== 1) throw new Error('execution_recovery_ambiguous_retry_receipt');
  const row = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('execution_recovery_invalid_retry_receipt');
  }
  const record = row as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'retry_at,state') {
    throw new Error('execution_recovery_invalid_retry_receipt');
  }
  if (record.state === 'pending') {
    if (!validInteger(record.retry_at) || (record.retry_at as number) <= generation.updatedAt) {
      throw new Error('execution_recovery_invalid_retry_receipt');
    }
    return { kind: 'pending', retryAt: record.retry_at as number };
  }
  if ((record.state === 'blocked' || record.state === 'completed') && record.retry_at === null) {
    return { kind: record.state };
  }
  throw new Error('execution_recovery_invalid_retry_receipt');
}

async function readCandidate(runId: string): Promise<ReadPersistedExternalRecoveryCandidateResult> {
  const control = getExecutionJournalDb().getFirstSync<unknown>(
    'SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?',
    runId,
  );
  if (
    !control ||
    typeof control !== 'object' ||
    Array.isArray(control) ||
    Object.keys(control).join(',') !== 'cancellation_state' ||
    !['active', 'cancel_requested', 'cancelled'].includes(
      String((control as Record<string, unknown>).cancellation_state),
    )
  ) {
    throw new Error('execution_recovery_invalid_control_state');
  }
  if ((control as { cancellation_state: string }).cancellation_state !== 'active') {
    return { kind: 'not_candidate', runId };
  }
  const result = await queryExecutionRecovery({ runId });
  if (result.kind === 'query_blocked') {
    return result.reason === 'run_unavailable'
      ? { kind: 'not_candidate', runId }
      : { kind: 'blocked', reason: 'journal_unavailable' };
  }
  if (result.command.kind !== 'reconcile_external_handles') {
    return { kind: 'not_candidate', runId };
  }
  const receipt = readCurrentGenerationReceipt(result.runId, result.generation);
  if (receipt.kind === 'blocked' || receipt.kind === 'completed') {
    return { kind: 'not_candidate', runId };
  }
  return {
    kind: 'candidate',
    candidate: {
      runId: result.runId,
      generation: result.generation,
      command: result.command,
      commandDigest: await digestExecutionRecoveryCommand(result.command),
      retryAt: receipt.kind === 'pending' ? receipt.retryAt : null,
    },
  };
}

export async function readPersistedExternalRecoveryCandidate(
  runId: string,
): Promise<ReadPersistedExternalRecoveryCandidateResult> {
  if (!validId(runId)) return { kind: 'blocked', reason: 'invalid_request' };
  try {
    return await readCandidate(runId);
  } catch {
    return { kind: 'blocked', reason: 'journal_unavailable' };
  }
}

/** Bounded deterministic scan for scheduler activation; every result is freshly replanned. */
export async function listPersistedExternalRecoveryCandidates(
  input: ListPersistedExternalRecoveryCandidatesInput,
): Promise<ListPersistedExternalRecoveryCandidatesResult> {
  if (!validInput(input)) return { kind: 'blocked', reason: 'invalid_request' };
  const cursor = input.after === undefined ? null : decodeCursor(input.after);
  try {
    const database = getExecutionJournalDb();
    const rawRows = cursor
      ? database.getAllSync<unknown>(
          `WITH candidate_runs(run_id) AS (
             SELECT run_id FROM execution_external_handles
             WHERE status IN ('unknown', 'pending', 'running')
             UNION
             SELECT e.run_id
             FROM execution_effects e
             JOIN execution_external_handles h
               ON h.run_id = e.run_id AND h.effect_id = e.id
             WHERE e.status IN ('started', 'ambiguous')
           )
           SELECT r.id, r.updated_at
           FROM execution_runs r
           JOIN candidate_runs c ON c.run_id = r.id
           WHERE r.updated_at > ? OR (r.updated_at = ? AND r.id > ?)
           ORDER BY r.updated_at ASC, r.id ASC
           LIMIT ?`,
          cursor.updatedAt,
          cursor.updatedAt,
          cursor.runId,
          input.limit + 1,
        )
      : database.getAllSync<unknown>(
          `WITH candidate_runs(run_id) AS (
             SELECT run_id FROM execution_external_handles
             WHERE status IN ('unknown', 'pending', 'running')
             UNION
             SELECT e.run_id
             FROM execution_effects e
             JOIN execution_external_handles h
               ON h.run_id = e.run_id AND h.effect_id = e.id
             WHERE e.status IN ('started', 'ambiguous')
           )
           SELECT r.id, r.updated_at
           FROM execution_runs r
           JOIN candidate_runs c ON c.run_id = r.id
           ORDER BY r.updated_at ASC, r.id ASC
           LIMIT ?`,
          input.limit + 1,
        );
    const rows = decodeRows(rawRows);
    if (!rows) return { kind: 'blocked', reason: 'journal_unavailable' };
    const scanRows = rows.slice(0, input.limit);

    const candidates: PersistedExternalRecoveryCandidate[] = [];
    for (const row of scanRows) {
      const result = await readCandidate(row.id);
      if (result.kind === 'blocked') {
        return { kind: 'blocked', reason: 'journal_unavailable' };
      }
      if (
        result.kind === 'not_candidate' ||
        result.candidate.generation.updatedAt !== row.updated_at
      ) {
        continue;
      }
      candidates.push(result.candidate);
    }
    const lastRow = scanRows.at(-1);
    return {
      kind: 'candidates',
      candidates,
      nextAfter:
        rows.length > input.limit && lastRow
          ? encodeCursor({ updatedAt: lastRow.updated_at, runId: lastRow.id })
          : null,
    };
  } catch {
    return { kind: 'blocked', reason: 'journal_unavailable' };
  }
}
