import type * as SQLite from 'expo-sqlite';
import { isCodeOwnedEffectFreeInvocation } from './toolEffectDispatchLifecycle';
import { getExecutionJournalDb } from './database';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

type ToolEffectRestartRow = Readonly<{
  run_id: string;
  run_status: string;
  resume_strategy: string;
  effect_status: string;
  outcome_digest: string | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
}>;

export type ToolEffectRestartDisposition =
  | Readonly<{ kind: 'not_dispatched' }>
  | Readonly<{ kind: 'terminal_without_verified_effect'; observedAt: number }>
  | Readonly<{ kind: 'verified'; observedAt: number }>
  | Readonly<{
      kind: 'reconciliation_required';
      observedAt: number | null;
      reason: 'ambiguous_effect' | 'journal_conflict' | 'journal_unavailable';
    }>;

export type ResolveToolEffectRestartDisposition = (input: {
  conversationId: string;
  taskId: string | null;
  toolCallId: string;
  toolName: string;
  argumentsText: string;
}) => ToolEffectRestartDisposition;

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

function decodeRow(value: unknown): ToolEffectRestartRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !==
      'completed_at,effect_status,outcome_digest,resume_strategy,run_id,run_status,started_at,updated_at' ||
    !validId(row.run_id) ||
    row.resume_strategy !== 'reconcile_first' ||
    !validTimestamp(row.updated_at) ||
    (row.started_at !== null && !validTimestamp(row.started_at)) ||
    (row.completed_at !== null && !validTimestamp(row.completed_at)) ||
    (row.outcome_digest !== null &&
      (typeof row.outcome_digest !== 'string' || !DIGEST_PATTERN.test(row.outcome_digest)))
  ) {
    return null;
  }
  if (
    (row.started_at !== null && row.started_at > (row.updated_at as number)) ||
    (row.completed_at !== null &&
      (row.started_at === null ||
        row.completed_at < row.started_at ||
        row.completed_at > (row.updated_at as number)))
  ) {
    return null;
  }
  return row as ToolEffectRestartRow;
}

function classifyRow(row: ToolEffectRestartRow): ToolEffectRestartDisposition {
  if (
    row.effect_status === 'verified' &&
    row.run_status === 'succeeded' &&
    row.outcome_digest !== null &&
    row.started_at !== null &&
    row.completed_at !== null
  ) {
    return { kind: 'verified', observedAt: row.completed_at };
  }
  if (
    row.effect_status === 'planned' &&
    row.started_at === null &&
    row.completed_at === null &&
    row.outcome_digest === null
  ) {
    return { kind: 'not_dispatched' };
  }
  if (
    ((row.effect_status === 'failed' && row.run_status === 'failed') ||
      (row.effect_status === 'cancelled' && row.run_status === 'cancelled')) &&
    row.started_at !== null &&
    row.completed_at !== null &&
    row.outcome_digest !== null
  ) {
    return {
      kind: 'terminal_without_verified_effect',
      observedAt: row.completed_at,
    };
  }
  return {
    kind: 'reconciliation_required',
    observedAt: row.updated_at,
    reason: 'ambiguous_effect',
  };
}

/**
 * Reads the exact durable effect generation linked to one foreground tool call.
 * A verified row proves only that the effect completed at that boundary; it
 * cannot reconstruct the original tool payload or authorize a retry.
 */
export function readToolEffectRestartDisposition(
  input: Parameters<ResolveToolEffectRestartDisposition>[0],
  options: { getDatabase?: () => SQLite.SQLiteDatabase } = {},
): ToolEffectRestartDisposition {
  if (
    !input ||
    !validId(input.conversationId) ||
    !validId(input.toolCallId) ||
    !validId(input.toolName) ||
    typeof input.argumentsText !== 'string' ||
    (input.taskId !== null && !validId(input.taskId))
  ) {
    return {
      kind: 'reconciliation_required',
      observedAt: null,
      reason: 'journal_conflict',
    };
  }
  if (isCodeOwnedEffectFreeInvocation(input.toolName, input.argumentsText)) {
    return { kind: 'not_dispatched' };
  }

  try {
    const rows = (options.getDatabase ?? getExecutionJournalDb)().getAllSync<unknown>(
      `SELECT r.id AS run_id, r.status AS run_status, r.resume_strategy,
              e.status AS effect_status, e.outcome_digest, e.started_at,
              e.completed_at, e.updated_at
         FROM execution_runs r
         JOIN execution_effects e ON e.run_id = r.id
        WHERE r.conversation_id = ?
          AND ((? IS NULL AND r.task_id IS NULL) OR r.task_id = ?)
          AND r.durability_class = 'external_durable_operation'
          AND r.resume_strategy = 'reconcile_first'
          AND e.tool_call_id = ?
        ORDER BY r.created_at DESC, r.id ASC
        LIMIT 2`,
      input.conversationId,
      input.taskId,
      input.taskId,
      input.toolCallId,
    );
    if (rows.length === 0) return { kind: 'not_dispatched' };
    if (rows.length !== 1) {
      return {
        kind: 'reconciliation_required',
        observedAt: null,
        reason: 'journal_conflict',
      };
    }
    const row = decodeRow(rows[0]);
    return row
      ? classifyRow(row)
      : {
          kind: 'reconciliation_required',
          observedAt: null,
          reason: 'journal_conflict',
        };
  } catch {
    return {
      kind: 'reconciliation_required',
      observedAt: null,
      reason: 'journal_unavailable',
    };
  }
}
