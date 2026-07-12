import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import type { ExecutionEffectStatus } from './types';
import { EXECUTION_EFFECT_STATUSES } from './types';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const BLOCKING_EFFECT_STATUSES = new Set<ExecutionEffectStatus>([
  'started',
  'applied',
  'ambiguous',
]);

const executionEffectTails = new Map<string, Promise<void>>();

export type ExecutionRunEffectBarrierResult =
  | { kind: 'clear' }
  | { kind: 'reconciliation_required'; blockingStatus: ExecutionEffectStatus }
  | { kind: 'identity_conflict' }
  | { kind: 'journal_unavailable' };

export function isCodeOwnedExecutionRunId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export function inspectExecutionRunEffectBarrier(
  conversationId: string,
  executionRunId: string,
  options: { getDatabase?: () => SQLite.SQLiteDatabase } = {},
): ExecutionRunEffectBarrierResult {
  if (!isCodeOwnedExecutionRunId(conversationId) || !isCodeOwnedExecutionRunId(executionRunId)) {
    return { kind: 'identity_conflict' };
  }

  try {
    const rows = (options.getDatabase ?? getExecutionJournalDb)().getAllSync<{
      conversation_id: unknown;
      effect_status: unknown;
    }>(
      `SELECT execution_runs.conversation_id AS conversation_id,
              execution_effects.status AS effect_status
       FROM execution_runs
       INNER JOIN execution_effects ON execution_effects.run_id = execution_runs.id
       WHERE execution_runs.task_id = ?
       ORDER BY execution_runs.id ASC, execution_effects.id ASC`,
      executionRunId,
    );

    for (const row of rows) {
      if (
        row.conversation_id !== conversationId ||
        typeof row.effect_status !== 'string' ||
        !EXECUTION_EFFECT_STATUSES.includes(row.effect_status as ExecutionEffectStatus)
      ) {
        return { kind: 'identity_conflict' };
      }
      const status = row.effect_status as ExecutionEffectStatus;
      if (BLOCKING_EFFECT_STATUSES.has(status)) {
        return { kind: 'reconciliation_required', blockingStatus: status };
      }
    }
    return { kind: 'clear' };
  } catch {
    return { kind: 'journal_unavailable' };
  }
}

export async function serializeExecutionRunEffectDispatch<T>(
  conversationId: string,
  executionRunId: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = `${conversationId}\u0000${executionRunId}`;
  const previous = executionEffectTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  executionEffectTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (executionEffectTails.get(key) === tail) {
      executionEffectTails.delete(key);
    }
  }
}
