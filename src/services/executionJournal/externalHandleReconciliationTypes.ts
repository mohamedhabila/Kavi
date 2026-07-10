import type {
  ExecutionRecoveryHandlerBlockReason,
  ExecutionRecoveryHandlerInput,
  ExecutionRecoveryHandlerRejectionReason,
  ExecutionRecoveryHandlerResult,
  ExecutionRecoveryPendingReason,
} from './recoveryCoordinatorTypes';
import type { ExecutionExternalHandleRecord, ExecutionExternalHandleStatus } from './types';

export type ExecutionExternalHandleReconciliationClaimResult =
  | { kind: 'claimed'; handles: ExecutionExternalHandleRecord[] }
  | { kind: 'rejected'; reason: ExecutionRecoveryHandlerRejectionReason };

export interface ExecutionExternalHandleObservation {
  handleId: string;
  expectedStatus: ExecutionExternalHandleStatus;
  observedStatus: ExecutionExternalHandleStatus | null;
}

export type ExecutionExternalHandleReconciliationDisposition =
  | { kind: 'completed' }
  | { kind: 'pending'; reason: ExecutionRecoveryPendingReason; retryAfterMs: number }
  | { kind: 'blocked'; reason: ExecutionRecoveryHandlerBlockReason };

export interface CompleteExecutionExternalHandleReconciliationInput extends ExecutionRecoveryHandlerInput<'reconcile_external_handles'> {
  observations: ExecutionExternalHandleObservation[];
  disposition: ExecutionExternalHandleReconciliationDisposition;
}

export interface ExecutionExternalHandleReconciliationStore {
  claim(
    input: ExecutionRecoveryHandlerInput<'reconcile_external_handles'>,
  ): ExecutionExternalHandleReconciliationClaimResult;
  complete(
    input: CompleteExecutionExternalHandleReconciliationInput,
  ): Promise<ExecutionRecoveryHandlerResult>;
}
