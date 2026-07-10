import {
  EXECUTION_RECOVERY_HANDLER_BLOCK_REASONS,
  EXECUTION_RECOVERY_HANDLER_REJECTION_REASONS,
  EXECUTION_RECOVERY_PENDING_REASONS,
  type DispatchableExecutionRecoveryCommand,
  type ExecutionRecoveryCoordinatorDeferReason,
  type ExecutionRecoveryDispatchContext,
  type ExecutionRecoveryFenceDeferReason,
  type ExecutionRecoveryHandlerRejectionReason,
  type ExecutionRecoveryHandlerResult,
  type ExecutionRecoveryHandlers,
} from './recoveryCoordinatorTypes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function validInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validExecutionRecoveryHandlerResult(
  value: unknown,
): value is ExecutionRecoveryHandlerResult {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'rejected') {
    return (
      hasExactKeys(value, ['kind', 'fenceId', 'fenceDigest', 'reason']) &&
      validId(value.fenceId) &&
      validDigest(value.fenceDigest) &&
      EXECUTION_RECOVERY_HANDLER_REJECTION_REASONS.includes(
        value.reason as ExecutionRecoveryHandlerRejectionReason,
      )
    );
  }
  if (value.kind === 'pending') {
    return (
      hasExactKeys(value, [
        'kind',
        'fenceId',
        'fenceDigest',
        'receiptId',
        'receiptDigest',
        'reason',
        'retryAt',
      ]) &&
      validId(value.fenceId) &&
      validDigest(value.fenceDigest) &&
      validId(value.receiptId) &&
      validDigest(value.receiptDigest) &&
      EXECUTION_RECOVERY_PENDING_REASONS.includes(value.reason as never) &&
      validInteger(value.retryAt)
    );
  }
  if (value.kind === 'blocked') {
    return (
      hasExactKeys(value, [
        'kind',
        'fenceId',
        'fenceDigest',
        'receiptId',
        'receiptDigest',
        'reason',
      ]) &&
      validId(value.fenceId) &&
      validDigest(value.fenceDigest) &&
      validId(value.receiptId) &&
      validDigest(value.receiptDigest) &&
      EXECUTION_RECOVERY_HANDLER_BLOCK_REASONS.includes(value.reason as never)
    );
  }
  return (
    value.kind === 'completed' &&
    hasExactKeys(value, ['kind', 'fenceId', 'fenceDigest', 'receiptId', 'receiptDigest']) &&
    validId(value.fenceId) &&
    validDigest(value.fenceDigest) &&
    validId(value.receiptId) &&
    validDigest(value.receiptDigest)
  );
}

export function hasExecutionRecoveryCommandHandler(
  command: DispatchableExecutionRecoveryCommand,
  handlers: ExecutionRecoveryHandlers,
): boolean {
  switch (command.kind) {
    case 'resume_model_step':
      return typeof handlers.resumeModelStep === 'function';
    case 'resume_persisted_tool_batch':
      return typeof handlers.resumePersistedToolBatch === 'function';
    case 'continue_after_tool_result':
      return typeof handlers.continueAfterToolResult === 'function';
    case 'reconcile_external_handles':
      return typeof handlers.reconcileExternalHandles === 'function';
    case 'resume_review':
      return typeof handlers.resumeReview === 'function';
    case 'finalize_existing_terminal_projection':
      return typeof handlers.finalizeExistingTerminalProjection === 'function';
  }
}

export async function routeExecutionRecoveryCommand(
  command: DispatchableExecutionRecoveryCommand,
  context: ExecutionRecoveryDispatchContext,
  handlers: ExecutionRecoveryHandlers,
): Promise<ExecutionRecoveryHandlerResult> {
  switch (command.kind) {
    case 'resume_model_step':
      return handlers.resumeModelStep!({ command, context });
    case 'resume_persisted_tool_batch':
      return handlers.resumePersistedToolBatch!({ command, context });
    case 'continue_after_tool_result':
      return handlers.continueAfterToolResult!({ command, context });
    case 'reconcile_external_handles':
      return handlers.reconcileExternalHandles!({ command, context });
    case 'resume_review':
      return handlers.resumeReview!({ command, context });
    case 'finalize_existing_terminal_projection':
      return handlers.finalizeExistingTerminalProjection!({ command, context });
  }
}

export function executionRecoveryFenceDeferReason(
  reason: ExecutionRecoveryFenceDeferReason,
): ExecutionRecoveryCoordinatorDeferReason {
  if (reason === 'fence_contended') return 'dispatch_fence_contended';
  if (reason === 'fence_changed') return 'dispatch_fence_changed';
  return 'dispatch_fence_unavailable';
}
