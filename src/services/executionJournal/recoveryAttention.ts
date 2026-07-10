import { getExecutionJournalDb } from './database';
import { readRun, withImmediateTransaction } from './mutationStore';
import {
  EXECUTION_RECOVERY_ATTENTION_REASONS,
  type ExecutionRecoveryAttentionReason,
} from './recoveryCoordinatorTypes';
import { queryExecutionRecovery, type ExecutionRecoveryGeneration } from './recoveryQuery';
import { canTransitionExecutionRun } from './transitions';

export interface RequestExecutionRecoveryAttentionInput {
  runId: string;
  expectedGeneration: ExecutionRecoveryGeneration;
  reason: ExecutionRecoveryAttentionReason;
  occurredAt: number;
}

export interface ExecutionRecoveryAttentionReceipt {
  runId: string;
  controlEpoch: number;
  sourceGenerationUpdatedAt: number;
  reason: ExecutionRecoveryAttentionReason;
  recordedAt: number;
}

export type RequestExecutionRecoveryAttentionResult =
  | { kind: 'recorded'; receipt: ExecutionRecoveryAttentionReceipt }
  | {
      kind: 'rejected';
      reason:
        | 'invalid_request'
        | 'generation_changed'
        | 'unsupported_recovery_command'
        | 'terminal_run'
        | 'transition_unavailable'
        | 'journal_unavailable';
    };

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

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function validGeneration(value: unknown): value is ExecutionRecoveryGeneration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const generation = value as Record<string, unknown>;
  return (
    Object.keys(generation).sort().join(',') === 'controlEpoch,snapshotDigest,updatedAt' &&
    validInteger(generation.controlEpoch) &&
    validInteger(generation.updatedAt) &&
    validDigest(generation.snapshotDigest)
  );
}

function validInput(value: unknown): value is RequestExecutionRecoveryAttentionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    Object.keys(input).sort().join(',') === 'expectedGeneration,occurredAt,reason,runId' &&
    validId(input.runId) &&
    validGeneration(input.expectedGeneration) &&
    EXECUTION_RECOVERY_ATTENTION_REASONS.includes(input.reason as never) &&
    validInteger(input.occurredAt) &&
    input.occurredAt > (input.expectedGeneration as ExecutionRecoveryGeneration).updatedAt
  );
}

/** Persists user attention in the journal before a platform lease is terminalized or released. */
export async function requestExecutionRecoveryAttention(
  input: RequestExecutionRecoveryAttentionInput,
): Promise<RequestExecutionRecoveryAttentionResult> {
  if (!validInput(input)) return { kind: 'rejected', reason: 'invalid_request' };

  const query = await queryExecutionRecovery({
    runId: input.runId,
    expectedGeneration: input.expectedGeneration,
  });
  if (query.kind === 'query_blocked') {
    return {
      kind: 'rejected',
      reason: query.reason === 'generation_mismatch' ? 'generation_changed' : 'journal_unavailable',
    };
  }
  if (query.command.kind !== 'reconcile_external_handles') {
    return { kind: 'rejected', reason: 'unsupported_recovery_command' };
  }

  try {
    const database = getExecutionJournalDb();
    return withImmediateTransaction(database, () => {
      const run = readRun(database, input.runId);
      if (
        run.controlEpoch !== input.expectedGeneration.controlEpoch ||
        run.updatedAt !== input.expectedGeneration.updatedAt
      ) {
        return { kind: 'rejected', reason: 'generation_changed' } as const;
      }
      if (['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        return { kind: 'rejected', reason: 'terminal_run' } as const;
      }
      if (!canTransitionExecutionRun(run.status, 'blocked')) {
        return { kind: 'rejected', reason: 'transition_unavailable' } as const;
      }

      database.runSync(
        `INSERT INTO execution_recovery_attention (
           run_id, control_epoch, source_generation_updated_at, reason, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
        run.id,
        run.controlEpoch,
        run.updatedAt,
        input.reason,
        input.occurredAt,
      );
      const update = database.runSync(
        `UPDATE execution_runs SET status = 'blocked', updated_at = ?
         WHERE id = ? AND status = ? AND control_epoch = ? AND updated_at = ?`,
        input.occurredAt,
        run.id,
        run.status,
        run.controlEpoch,
        run.updatedAt,
      );
      if (update.changes !== 1) {
        throw new Error('execution_recovery_concurrent_attention');
      }
      return {
        kind: 'recorded',
        receipt: {
          runId: run.id,
          controlEpoch: run.controlEpoch,
          sourceGenerationUpdatedAt: run.updatedAt,
          reason: input.reason,
          recordedAt: input.occurredAt,
        },
      } as const;
    });
  } catch {
    return { kind: 'rejected', reason: 'journal_unavailable' };
  }
}
