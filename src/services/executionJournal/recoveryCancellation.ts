import { cancelAgentRunOperations } from '../agents/agentRunCancellation';
import { getExecutionJournalDb } from './database';
import { readRun } from './mutationStore';
import {
  createExecutionRecoveryControlStore,
  type ExecutionRecoveryCancellationReceipt,
} from './recoveryControlStore';
import { queryExecutionRecovery, type ExecutionRecoveryGeneration } from './recoveryQuery';

export interface RequestPersistedExecutionRecoveryCancellationInput {
  runId: string;
  expectedGeneration: ExecutionRecoveryGeneration;
  occurredAt: number;
  reason?: unknown;
}

export type RequestPersistedExecutionRecoveryCancellationResult =
  | { kind: 'requested'; receipt: ExecutionRecoveryCancellationReceipt }
  | {
      kind: 'rejected';
      reason: 'invalid_request' | 'generation_changed' | 'journal_unavailable';
    };

interface RecoveryCancellationDependencies {
  abortOwner(conversationId: string, ownerRunId: string, reason?: unknown): void;
}

const DEFAULT_DEPENDENCIES: RecoveryCancellationDependencies = {
  abortOwner: (conversationId, ownerRunId, reason) => {
    cancelAgentRunOperations(conversationId, ownerRunId, reason);
  },
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

function validGeneration(value: unknown): value is ExecutionRecoveryGeneration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const generation = value as Record<string, unknown>;
  return (
    Object.keys(generation).sort().join(',') === 'controlEpoch,snapshotDigest,updatedAt' &&
    Number.isSafeInteger(generation.controlEpoch) &&
    (generation.controlEpoch as number) >= 0 &&
    Number.isSafeInteger(generation.updatedAt) &&
    (generation.updatedAt as number) >= 0 &&
    typeof generation.snapshotDigest === 'string' &&
    /^[a-f0-9]{64}$/u.test(generation.snapshotDigest)
  );
}

function validInput(value: unknown): value is RequestPersistedExecutionRecoveryCancellationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(',');
  return (
    (keys === 'expectedGeneration,occurredAt,runId' ||
      keys === 'expectedGeneration,occurredAt,reason,runId') &&
    validId(input.runId) &&
    validGeneration(input.expectedGeneration) &&
    Number.isSafeInteger(input.occurredAt) &&
    (input.occurredAt as number) >
      (input.expectedGeneration as ExecutionRecoveryGeneration).updatedAt
  );
}

/** Journal cancellation becomes authoritative before any native lease or JS owner is stopped. */
export async function requestPersistedExecutionRecoveryCancellation(
  input: RequestPersistedExecutionRecoveryCancellationInput,
  dependencies: RecoveryCancellationDependencies = DEFAULT_DEPENDENCIES,
): Promise<RequestPersistedExecutionRecoveryCancellationResult> {
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

  try {
    const run = readRun(getExecutionJournalDb(), input.runId);
    if (
      run.controlEpoch !== input.expectedGeneration.controlEpoch ||
      run.updatedAt !== input.expectedGeneration.updatedAt
    ) {
      return { kind: 'rejected', reason: 'generation_changed' };
    }
    const receipt = createExecutionRecoveryControlStore().requestCancellation({
      runId: run.id,
      expectedControlEpoch: run.controlEpoch,
      occurredAt: input.occurredAt,
    });
    dependencies.abortOwner(
      run.conversationId,
      run.taskId ?? run.id,
      input.reason ?? 'Durable recovery was cancelled.',
    );
    return { kind: 'requested', receipt };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'execution_recovery_stale_control_epoch' ||
        error.message === 'execution_recovery_non_monotonic_time' ||
        error.message === 'execution_recovery_concurrent_cancellation')
    ) {
      return { kind: 'rejected', reason: 'generation_changed' };
    }
    return { kind: 'rejected', reason: 'journal_unavailable' };
  }
}
