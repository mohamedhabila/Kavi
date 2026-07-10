import * as Crypto from 'expo-crypto';
import {
  EXECUTION_RECOVERY_BLOCK_REASONS,
  type ExecutionRecoveryBlockReason,
  type ExecutionRecoveryCommand,
} from './recoveryPlanner';
import type {
  ExecutionRecoveryGeneration,
  ExecutionRecoveryQueryBlockReason,
  ExecutionRecoveryQueryResult,
} from './recoveryQuery';
import {
  EXECUTION_RECOVERY_AUTHORITY_STATES,
  EXECUTION_RECOVERY_CANCELLATION_STATES,
  EXECUTION_RECOVERY_CONTROL_DEFER_REASONS,
  EXECUTION_RECOVERY_FENCE_DEFER_REASONS,
  EXECUTION_RECOVERY_HANDLER_REJECTION_REASONS,
  type DispatchableExecutionRecoveryCommand,
  type ExecutionRecoveryAuthorityResult,
  type ExecutionRecoveryAuthorityState,
  type ExecutionRecoveryCancellationState,
  type ExecutionRecoveryCoordinatorBlockReason,
  type ExecutionRecoveryCoordinatorDeferReason,
  type ExecutionRecoveryCoordinatorInput,
  type ExecutionRecoveryCoordinatorOutcome,
  type ExecutionRecoveryCoordinatorPorts,
  type ExecutionRecoveryDispatchContext,
  type ExecutionRecoveryDispatchFence,
  type ExecutionRecoveryDispatchFenceIntent,
  type ExecutionRecoveryDispatchFenceResult,
  type ExecutionRecoveryFenceDeferReason,
  type ExecutionRecoveryHandlerRejectionReason,
  type ExecutionRecoveryHandlerResult,
  type ExecutionRecoveryHandlers,
} from './recoveryCoordinatorTypes';

type RecoveryCommandKind = ExecutionRecoveryCommand['kind'];
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

const COMMAND_DIGEST_FORMAT = 'kavi.execution-recovery-command.v1';

const COMMAND_AUTHORITY_POLICY = {
  resume_model_step: 'active_execution',
  resume_persisted_tool_batch: 'active_execution',
  continue_after_tool_result: 'active_execution',
  reconcile_external_handles: 'settle_existing',
  resume_review: 'active_execution',
  finalize_existing_terminal_projection: 'settle_existing',
  block: 'blocked',
} as const satisfies Record<
  RecoveryCommandKind,
  'active_execution' | 'settle_existing' | 'blocked'
>;

const HANDLER_REJECTION_POLICY = {
  generation_changed: 'fence_changed',
  authority_changed: 'fence_changed',
  control_epoch_changed: 'fence_changed',
  cancelled: 'fence_changed',
  duplicate_dispatch: 'duplicate',
  prerequisite_changed: 'blocked',
  handler_unavailable: 'blocked',
} as const satisfies Record<
  ExecutionRecoveryHandlerRejectionReason,
  'fence_changed' | 'duplicate' | 'blocked'
>;

const KNOWN_QUERY_BLOCK_REASONS = {
  invalid_request: true,
  run_unavailable: true,
  journal_unavailable: true,
  malformed_row: true,
  mixed_ownership: true,
  missing_history: true,
  generation_mismatch: true,
} as const satisfies Record<ExecutionRecoveryQueryBlockReason, true>;

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

function validSortedIds(value: unknown, allowEmpty: boolean): value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || !value.every(validId)) {
    return false;
  }
  return JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
}

function validGeneration(value: unknown): value is ExecutionRecoveryGeneration {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['controlEpoch', 'updatedAt', 'snapshotDigest']) &&
    validInteger(value.controlEpoch) &&
    validInteger(value.updatedAt) &&
    validDigest(value.snapshotDigest)
  );
}

function validPointer(command: Record<string, unknown>): boolean {
  return (
    validId(command.runId) &&
    validId(command.checkpointId) &&
    validInteger(command.controlEpoch) &&
    validId(command.stateRefId) &&
    validDigest(command.stateDigest)
  );
}

function validRecoveryCommand(value: unknown): value is ExecutionRecoveryCommand {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'resume_model_step':
    case 'resume_review':
      return (
        hasExactKeys(value, [
          'kind',
          'runId',
          'checkpointId',
          'controlEpoch',
          'stateRefId',
          'stateDigest',
        ]) && validPointer(value)
      );
    case 'resume_persisted_tool_batch':
      return (
        hasExactKeys(value, [
          'kind',
          'runId',
          'checkpointId',
          'controlEpoch',
          'stateRefId',
          'stateDigest',
          'plannedEffectIds',
          'replayEffectIds',
          'requiresExecutionAuthorityRevalidation',
        ]) &&
        validPointer(value) &&
        validSortedIds(value.plannedEffectIds, true) &&
        validSortedIds(value.replayEffectIds, true) &&
        value.requiresExecutionAuthorityRevalidation === true &&
        !(value.plannedEffectIds as string[]).some((id) =>
          (value.replayEffectIds as string[]).includes(id),
        )
      );
    case 'continue_after_tool_result':
      return (
        hasExactKeys(value, [
          'kind',
          'runId',
          'checkpointId',
          'controlEpoch',
          'stateRefId',
          'stateDigest',
          'completedEffectIds',
        ]) &&
        validPointer(value) &&
        validSortedIds(value.completedEffectIds, true)
      );
    case 'reconcile_external_handles':
      return (
        hasExactKeys(value, ['kind', 'runId', 'controlEpoch', 'effectIds', 'handleIds']) &&
        validId(value.runId) &&
        validInteger(value.controlEpoch) &&
        validSortedIds(value.effectIds, false) &&
        validSortedIds(value.handleIds, false)
      );
    case 'finalize_existing_terminal_projection':
      return (
        hasExactKeys(value, [
          'kind',
          'runId',
          'checkpointId',
          'controlEpoch',
          'stateRefId',
          'stateDigest',
          'terminalStatus',
          'terminalAt',
        ]) &&
        validPointer(value) &&
        ['succeeded', 'failed', 'cancelled'].includes(value.terminalStatus as string) &&
        validInteger(value.terminalAt)
      );
    case 'block':
      return (
        hasExactKeys(value, [
          'kind',
          'runId',
          'controlEpoch',
          'reason',
          'checkpointId',
          'effectIds',
          'handleIds',
        ]) &&
        validId(value.runId) &&
        validInteger(value.controlEpoch) &&
        (value.checkpointId === null || validId(value.checkpointId)) &&
        EXECUTION_RECOVERY_BLOCK_REASONS.includes(value.reason as ExecutionRecoveryBlockReason) &&
        validSortedIds(value.effectIds, true) &&
        validSortedIds(value.handleIds, true)
      );
    default:
      return false;
  }
}

function validPlanResult(
  value: unknown,
): value is Extract<ExecutionRecoveryQueryResult, { kind: 'recovery_plan' }> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['kind', 'runId', 'generation', 'command']) &&
    value.kind === 'recovery_plan' &&
    validId(value.runId) &&
    validGeneration(value.generation) &&
    validRecoveryCommand(value.command) &&
    value.command.runId === value.runId &&
    value.command.controlEpoch === value.generation.controlEpoch
  );
}

function validBlockedQueryResult(
  value: unknown,
): value is Extract<ExecutionRecoveryQueryResult, { kind: 'query_blocked' }> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['kind', 'runId', 'generation', 'reason']) &&
    value.kind === 'query_blocked' &&
    (value.runId === null || validId(value.runId)) &&
    value.generation === null &&
    typeof value.reason === 'string' &&
    KNOWN_QUERY_BLOCK_REASONS[value.reason as ExecutionRecoveryQueryBlockReason] === true
  );
}

function canonicalCommand(command: ExecutionRecoveryCommand): string {
  switch (command.kind) {
    case 'resume_model_step':
    case 'resume_review':
      return JSON.stringify([
        command.kind,
        command.runId,
        command.checkpointId,
        command.controlEpoch,
        command.stateRefId,
        command.stateDigest,
      ]);
    case 'resume_persisted_tool_batch':
      return JSON.stringify([
        command.kind,
        command.runId,
        command.checkpointId,
        command.controlEpoch,
        command.stateRefId,
        command.stateDigest,
        command.plannedEffectIds,
        command.replayEffectIds,
        command.requiresExecutionAuthorityRevalidation,
      ]);
    case 'continue_after_tool_result':
      return JSON.stringify([
        command.kind,
        command.runId,
        command.checkpointId,
        command.controlEpoch,
        command.stateRefId,
        command.stateDigest,
        command.completedEffectIds,
      ]);
    case 'reconcile_external_handles':
      return JSON.stringify([
        command.kind,
        command.runId,
        command.controlEpoch,
        command.effectIds,
        command.handleIds,
      ]);
    case 'finalize_existing_terminal_projection':
      return JSON.stringify([
        command.kind,
        command.runId,
        command.checkpointId,
        command.controlEpoch,
        command.stateRefId,
        command.stateDigest,
        command.terminalStatus,
        command.terminalAt,
      ]);
    case 'block':
      return JSON.stringify([
        command.kind,
        command.runId,
        command.controlEpoch,
        command.reason,
        command.checkpointId,
        command.effectIds,
        command.handleIds,
      ]);
  }
}

async function digestCommand(command: DispatchableExecutionRecoveryCommand): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${COMMAND_DIGEST_FORMAT}\u0000${canonicalCommand(command)}`,
  );
  if (!validDigest(digest)) {
    throw new Error('execution_recovery_invalid_command_digest');
  }
  return digest;
}

function planPointer(
  result: Extract<ExecutionRecoveryQueryResult, { kind: 'recovery_plan' }>,
  commandDigest: string | null,
): CoordinatorOutcomePointer {
  return {
    runId: result.runId,
    commandKind: result.command.kind,
    controlEpoch: result.generation.controlEpoch,
    snapshotDigest: result.generation.snapshotDigest,
    commandDigest,
    dispatchId: null,
    dispatchDigest: null,
    fenceId: null,
    fenceDigest: null,
  };
}

function blocked(
  pointer: CoordinatorOutcomePointer,
  reason: ExecutionRecoveryCoordinatorBlockReason,
  sourceReason: ClosedSourceReason = null,
): ExecutionRecoveryCoordinatorOutcome {
  return { kind: 'blocked', ...pointer, reason, sourceReason };
}

function deferred(
  pointer: CoordinatorOutcomePointer,
  reason: ExecutionRecoveryCoordinatorDeferReason,
): ExecutionRecoveryCoordinatorOutcome {
  return { kind: 'deferred', ...pointer, reason };
}

function validAuthorityResult(value: unknown): value is ExecutionRecoveryAuthorityResult {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'control_deferred') {
    return (
      hasExactKeys(value, ['kind', 'reason']) &&
      EXECUTION_RECOVERY_CONTROL_DEFER_REASONS.includes(
        value.reason as (typeof EXECUTION_RECOVERY_CONTROL_DEFER_REASONS)[number],
      )
    );
  }
  return (
    value.kind === 'authority_snapshot' &&
    hasExactKeys(value, [
      'kind',
      'runId',
      'controlEpoch',
      'cancellationState',
      'executionAuthority',
      'authorityDigest',
    ]) &&
    validId(value.runId) &&
    validInteger(value.controlEpoch) &&
    EXECUTION_RECOVERY_CANCELLATION_STATES.includes(
      value.cancellationState as ExecutionRecoveryCancellationState,
    ) &&
    EXECUTION_RECOVERY_AUTHORITY_STATES.includes(
      value.executionAuthority as ExecutionRecoveryAuthorityState,
    ) &&
    validDigest(value.authorityDigest)
  );
}

function validFenceResult(value: unknown): value is ExecutionRecoveryDispatchFenceResult {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'fence_deferred') {
    return (
      hasExactKeys(value, ['kind', 'reason']) &&
      EXECUTION_RECOVERY_FENCE_DEFER_REASONS.includes(
        value.reason as ExecutionRecoveryFenceDeferReason,
      )
    );
  }
  return (
    (value.kind === 'fence_acquired' || value.kind === 'duplicate') &&
    hasExactKeys(value, ['kind', 'dispatchId', 'dispatchDigest', 'fenceId', 'fenceDigest']) &&
    validId(value.dispatchId) &&
    validDigest(value.dispatchDigest) &&
    validId(value.fenceId) &&
    validDigest(value.fenceDigest)
  );
}

function validHandlerResult(value: unknown): value is ExecutionRecoveryHandlerResult {
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
  return (
    value.kind === 'accepted' &&
    hasExactKeys(value, ['kind', 'fenceId', 'fenceDigest', 'receiptId', 'receiptDigest']) &&
    validId(value.fenceId) &&
    validDigest(value.fenceDigest) &&
    validId(value.receiptId) &&
    validDigest(value.receiptDigest)
  );
}

async function routeCommand(
  command: DispatchableExecutionRecoveryCommand,
  context: ExecutionRecoveryDispatchContext,
  handlers: ExecutionRecoveryHandlers,
): Promise<ExecutionRecoveryHandlerResult> {
  switch (command.kind) {
    case 'resume_model_step':
      return handlers.resumeModelStep({ command, context });
    case 'resume_persisted_tool_batch':
      return handlers.resumePersistedToolBatch({ command, context });
    case 'continue_after_tool_result':
      return handlers.continueAfterToolResult({ command, context });
    case 'reconcile_external_handles':
      return handlers.reconcileExternalHandles({ command, context });
    case 'resume_review':
      return handlers.resumeReview({ command, context });
    case 'finalize_existing_terminal_projection':
      return handlers.finalizeExistingTerminalProjection({ command, context });
  }
}

function fenceDeferReason(
  reason: ExecutionRecoveryFenceDeferReason,
): ExecutionRecoveryCoordinatorDeferReason {
  return reason === 'fence_contended' ? 'dispatch_fence_contended' : 'dispatch_fence_unavailable';
}

export async function coordinateExecutionRecovery(
  input: ExecutionRecoveryCoordinatorInput,
  ports: ExecutionRecoveryCoordinatorPorts,
): Promise<ExecutionRecoveryCoordinatorOutcome> {
  const initial: unknown = input?.queryResult;
  if (validBlockedQueryResult(initial)) {
    const pointer: CoordinatorOutcomePointer = {
      runId: initial.runId,
      commandKind: null,
      controlEpoch: null,
      snapshotDigest: null,
      commandDigest: null,
      dispatchId: null,
      dispatchDigest: null,
      fenceId: null,
      fenceDigest: null,
    };
    if (initial.reason === 'generation_mismatch') {
      return deferred(pointer, 'generation_changed');
    }
    if (initial.reason === 'journal_unavailable') {
      return deferred(pointer, 'query_unavailable');
    }
    return blocked(pointer, 'query_blocked', initial.reason);
  }
  if (!validPlanResult(initial)) {
    return blocked(
      {
        runId: null,
        commandKind: null,
        controlEpoch: null,
        snapshotDigest: null,
        commandDigest: null,
        dispatchId: null,
        dispatchDigest: null,
        fenceId: null,
        fenceDigest: null,
      },
      'invalid_plan',
    );
  }

  if (initial.command.kind === 'block') {
    return blocked(planPointer(initial, null), 'planner_blocked', initial.command.reason);
  }

  let commandDigest: string;
  try {
    commandDigest = await digestCommand(initial.command);
  } catch {
    return deferred(planPointer(initial, null), 'dispatch_fence_unavailable');
  }
  const pointer = planPointer(initial, commandDigest);

  let current: ExecutionRecoveryQueryResult;
  try {
    current = await ports.queryRecovery({
      runId: initial.runId,
      expectedGeneration: initial.generation,
    });
  } catch {
    return deferred(pointer, 'query_unavailable');
  }
  if (validBlockedQueryResult(current)) {
    if (current.reason === 'generation_mismatch') {
      return deferred(pointer, 'generation_changed');
    }
    if (current.reason === 'journal_unavailable') {
      return deferred(pointer, 'query_unavailable');
    }
    return blocked(pointer, 'revalidation_blocked', current.reason);
  }
  if (
    !validPlanResult(current) ||
    current.command.kind === 'block' ||
    current.runId !== initial.runId ||
    current.generation.controlEpoch !== initial.generation.controlEpoch ||
    current.generation.updatedAt !== initial.generation.updatedAt ||
    current.generation.snapshotDigest !== initial.generation.snapshotDigest ||
    canonicalCommand(current.command) !== canonicalCommand(initial.command)
  ) {
    return blocked(pointer, 'revalidation_mismatch');
  }
  const command = current.command;

  const authorityInput = {
    runId: current.runId,
    controlEpoch: current.generation.controlEpoch,
    snapshotDigest: current.generation.snapshotDigest,
    commandKind: command.kind,
    commandDigest,
  };
  let authority: ExecutionRecoveryAuthorityResult;
  try {
    authority = await ports.readAuthority(authorityInput);
  } catch {
    return deferred(pointer, 'authority_unavailable');
  }
  if (!validAuthorityResult(authority)) {
    return blocked(pointer, 'invalid_authority');
  }
  if (authority.kind === 'control_deferred') {
    return deferred(pointer, 'authority_unavailable');
  }
  if (
    authority.runId !== current.runId ||
    authority.controlEpoch !== current.generation.controlEpoch
  ) {
    return blocked(pointer, 'control_epoch_changed');
  }

  if (COMMAND_AUTHORITY_POLICY[command.kind] === 'active_execution') {
    if (authority.cancellationState !== 'active') {
      return blocked(pointer, 'cancelled');
    }
    if (authority.executionAuthority === 'pending') {
      return deferred(pointer, 'authority_pending');
    }
    if (authority.executionAuthority === 'unavailable') {
      return deferred(pointer, 'authority_unavailable');
    }
    if (authority.executionAuthority === 'revoked') {
      return blocked(pointer, 'authority_revoked');
    }
  }

  const fenceIntent: ExecutionRecoveryDispatchFenceIntent = {
    ...authorityInput,
    cancellationState: authority.cancellationState,
    executionAuthority: authority.executionAuthority,
    authorityDigest: authority.authorityDigest,
  };
  let fenceResult: ExecutionRecoveryDispatchFenceResult;
  try {
    fenceResult = await ports.acquireDispatchFence(fenceIntent);
  } catch {
    return deferred(pointer, 'dispatch_fence_unavailable');
  }
  if (!validFenceResult(fenceResult)) {
    return blocked(pointer, 'invalid_dispatch_fence');
  }
  if (fenceResult.kind === 'fence_deferred') {
    return deferred(pointer, fenceDeferReason(fenceResult.reason));
  }
  const fencedPointer: CoordinatorOutcomePointer = {
    ...pointer,
    dispatchId: fenceResult.dispatchId,
    dispatchDigest: fenceResult.dispatchDigest,
    fenceId: fenceResult.fenceId,
    fenceDigest: fenceResult.fenceDigest,
  };
  if (fenceResult.kind === 'duplicate') {
    return deferred(fencedPointer, 'duplicate_dispatch');
  }

  const fence: ExecutionRecoveryDispatchFence = {
    ...fenceIntent,
    dispatchId: fenceResult.dispatchId,
    dispatchDigest: fenceResult.dispatchDigest,
    fenceId: fenceResult.fenceId,
    fenceDigest: fenceResult.fenceDigest,
  };
  const context: ExecutionRecoveryDispatchContext = {
    fence,
    generation: current.generation,
  };
  let handlerResult: ExecutionRecoveryHandlerResult;
  try {
    handlerResult = await routeCommand(command, context, ports.handlers);
  } catch {
    return blocked(fencedPointer, 'handler_failed');
  }
  if (
    !validHandlerResult(handlerResult) ||
    handlerResult.fenceId !== fence.fenceId ||
    handlerResult.fenceDigest !== fence.fenceDigest
  ) {
    return blocked(fencedPointer, 'handler_failed');
  }
  if (handlerResult.kind === 'rejected') {
    const rejectionPolicy = HANDLER_REJECTION_POLICY[handlerResult.reason];
    if (rejectionPolicy === 'fence_changed') {
      return deferred(fencedPointer, 'dispatch_fence_changed');
    }
    if (rejectionPolicy === 'duplicate') {
      return deferred(fencedPointer, 'duplicate_dispatch');
    }
    return blocked(fencedPointer, 'handler_rejected');
  }

  return {
    kind: 'dispatched',
    runId: current.runId,
    commandKind: command.kind,
    controlEpoch: current.generation.controlEpoch,
    snapshotDigest: current.generation.snapshotDigest,
    commandDigest,
    authorityDigest: authority.authorityDigest,
    dispatchId: fenceResult.dispatchId,
    dispatchDigest: fenceResult.dispatchDigest,
    fenceId: fenceResult.fenceId,
    fenceDigest: fenceResult.fenceDigest,
    receiptId: handlerResult.receiptId,
    receiptDigest: handlerResult.receiptDigest,
  };
}
