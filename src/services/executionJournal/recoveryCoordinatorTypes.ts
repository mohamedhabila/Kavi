import type { ExecutionRecoveryBlockReason, ExecutionRecoveryCommand } from './recoveryPlanner';
import type {
  ExecutionRecoveryGeneration,
  ExecutionRecoveryQueryBlockReason,
  ExecutionRecoveryQueryInput,
  ExecutionRecoveryQueryResult,
} from './recoveryQuery';

type RecoveryCommandKind = ExecutionRecoveryCommand['kind'];
export type DispatchableExecutionRecoveryCommand = Exclude<
  ExecutionRecoveryCommand,
  { kind: 'block' }
>;
export type DispatchableExecutionRecoveryCommandKind = DispatchableExecutionRecoveryCommand['kind'];

export const EXECUTION_RECOVERY_CANCELLATION_STATES = [
  'active',
  'cancel_requested',
  'cancelled',
] as const;
export const EXECUTION_RECOVERY_AUTHORITY_STATES = [
  'granted',
  'pending',
  'revoked',
  'unavailable',
] as const;
export const EXECUTION_RECOVERY_CONTROL_DEFER_REASONS = ['control_unavailable'] as const;
export const EXECUTION_RECOVERY_FENCE_DEFER_REASONS = [
  'fence_contended',
  'fence_unavailable',
] as const;
export const EXECUTION_RECOVERY_HANDLER_REJECTION_REASONS = [
  'generation_changed',
  'authority_changed',
  'control_epoch_changed',
  'cancelled',
  'duplicate_dispatch',
  'prerequisite_changed',
  'handler_unavailable',
] as const;

export type ExecutionRecoveryCancellationState =
  (typeof EXECUTION_RECOVERY_CANCELLATION_STATES)[number];
export type ExecutionRecoveryAuthorityState = (typeof EXECUTION_RECOVERY_AUTHORITY_STATES)[number];
export type ExecutionRecoveryControlDeferReason =
  (typeof EXECUTION_RECOVERY_CONTROL_DEFER_REASONS)[number];
export type ExecutionRecoveryFenceDeferReason =
  (typeof EXECUTION_RECOVERY_FENCE_DEFER_REASONS)[number];
export type ExecutionRecoveryHandlerRejectionReason =
  (typeof EXECUTION_RECOVERY_HANDLER_REJECTION_REASONS)[number];

export interface ExecutionRecoveryAuthoritySnapshot {
  kind: 'authority_snapshot';
  runId: string;
  controlEpoch: number;
  cancellationState: ExecutionRecoveryCancellationState;
  executionAuthority: ExecutionRecoveryAuthorityState;
  /** SHA-256 over the exact control, cancellation, and execution-authority snapshot. */
  authorityDigest: string;
}

export type ExecutionRecoveryAuthorityResult =
  | ExecutionRecoveryAuthoritySnapshot
  | { kind: 'control_deferred'; reason: ExecutionRecoveryControlDeferReason };

export interface ExecutionRecoveryAuthorityInput {
  runId: string;
  controlEpoch: number;
  snapshotDigest: string;
  commandKind: DispatchableExecutionRecoveryCommandKind;
  commandDigest: string;
}

export interface ExecutionRecoveryDispatchFenceIntent extends ExecutionRecoveryAuthorityInput {
  cancellationState: ExecutionRecoveryCancellationState;
  executionAuthority: ExecutionRecoveryAuthorityState;
  authorityDigest: string;
}

export type ExecutionRecoveryDispatchFenceResult =
  | {
      kind: 'fence_acquired';
      dispatchId: string;
      dispatchDigest: string;
      fenceId: string;
      fenceDigest: string;
    }
  | {
      kind: 'duplicate';
      dispatchId: string;
      dispatchDigest: string;
      fenceId: string;
      fenceDigest: string;
    }
  | { kind: 'fence_deferred'; reason: ExecutionRecoveryFenceDeferReason };

export interface ExecutionRecoveryDispatchFence extends ExecutionRecoveryDispatchFenceIntent {
  dispatchId: string;
  dispatchDigest: string;
  fenceId: string;
  fenceDigest: string;
}

export interface ExecutionRecoveryDispatchContext {
  fence: ExecutionRecoveryDispatchFence;
  generation: ExecutionRecoveryGeneration;
}

export type ExecutionRecoveryHandlerResult =
  | {
      kind: 'accepted';
      fenceId: string;
      fenceDigest: string;
      receiptId: string;
      receiptDigest: string;
    }
  | {
      kind: 'rejected';
      fenceId: string;
      fenceDigest: string;
      reason: ExecutionRecoveryHandlerRejectionReason;
    };

type HandlerInput<K extends DispatchableExecutionRecoveryCommandKind> = {
  command: Extract<DispatchableExecutionRecoveryCommand, { kind: K }>;
  context: ExecutionRecoveryDispatchContext;
};

/** Every handler atomically validates and consumes the single-use fence before any effect. */
export interface ExecutionRecoveryHandlers {
  resumeModelStep(
    input: HandlerInput<'resume_model_step'>,
  ): Promise<ExecutionRecoveryHandlerResult>;
  resumePersistedToolBatch(
    input: HandlerInput<'resume_persisted_tool_batch'>,
  ): Promise<ExecutionRecoveryHandlerResult>;
  continueAfterToolResult(
    input: HandlerInput<'continue_after_tool_result'>,
  ): Promise<ExecutionRecoveryHandlerResult>;
  reconcileExternalHandles(
    input: HandlerInput<'reconcile_external_handles'>,
  ): Promise<ExecutionRecoveryHandlerResult>;
  resumeReview(input: HandlerInput<'resume_review'>): Promise<ExecutionRecoveryHandlerResult>;
  finalizeExistingTerminalProjection(
    input: HandlerInput<'finalize_existing_terminal_projection'>,
  ): Promise<ExecutionRecoveryHandlerResult>;
}

export interface ExecutionRecoveryCoordinatorPorts {
  queryRecovery(input: ExecutionRecoveryQueryInput): Promise<ExecutionRecoveryQueryResult>;
  readAuthority(input: ExecutionRecoveryAuthorityInput): Promise<ExecutionRecoveryAuthorityResult>;
  /** Atomically compare the full intent and acquire one single-use dispatch fence. */
  acquireDispatchFence(
    input: ExecutionRecoveryDispatchFenceIntent,
  ): Promise<ExecutionRecoveryDispatchFenceResult>;
  handlers: ExecutionRecoveryHandlers;
}

export const EXECUTION_RECOVERY_COORDINATOR_BLOCK_REASONS = [
  'query_blocked',
  'planner_blocked',
  'invalid_plan',
  'revalidation_blocked',
  'revalidation_mismatch',
  'control_epoch_changed',
  'invalid_authority',
  'authority_revoked',
  'cancelled',
  'invalid_dispatch_fence',
  'handler_rejected',
  'handler_failed',
] as const;

export const EXECUTION_RECOVERY_COORDINATOR_DEFER_REASONS = [
  'generation_changed',
  'query_unavailable',
  'authority_pending',
  'authority_unavailable',
  'duplicate_dispatch',
  'dispatch_fence_contended',
  'dispatch_fence_unavailable',
  'dispatch_fence_changed',
] as const;

export type ExecutionRecoveryCoordinatorBlockReason =
  (typeof EXECUTION_RECOVERY_COORDINATOR_BLOCK_REASONS)[number];
export type ExecutionRecoveryCoordinatorDeferReason =
  (typeof EXECUTION_RECOVERY_COORDINATOR_DEFER_REASONS)[number];
type ClosedSourceReason = ExecutionRecoveryQueryBlockReason | ExecutionRecoveryBlockReason | null;

interface CoordinatorOutcomePointer {
  runId: string | null;
  commandKind: RecoveryCommandKind | null;
  controlEpoch: number | null;
  snapshotDigest: string | null;
  commandDigest: string | null;
  dispatchId: string | null;
  dispatchDigest: string | null;
  fenceId: string | null;
  fenceDigest: string | null;
}

export type ExecutionRecoveryCoordinatorOutcome =
  | (CoordinatorOutcomePointer & {
      kind: 'blocked';
      reason: ExecutionRecoveryCoordinatorBlockReason;
      sourceReason: ClosedSourceReason;
    })
  | (CoordinatorOutcomePointer & {
      kind: 'deferred';
      reason: ExecutionRecoveryCoordinatorDeferReason;
    })
  | {
      kind: 'dispatched';
      runId: string;
      commandKind: DispatchableExecutionRecoveryCommandKind;
      controlEpoch: number;
      snapshotDigest: string;
      commandDigest: string;
      authorityDigest: string;
      dispatchId: string;
      dispatchDigest: string;
      fenceId: string;
      fenceDigest: string;
      receiptId: string;
      receiptDigest: string;
    };

export interface ExecutionRecoveryCoordinatorInput {
  queryResult: ExecutionRecoveryQueryResult;
}
