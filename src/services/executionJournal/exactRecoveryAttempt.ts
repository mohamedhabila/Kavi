import type { ExecutionRecoveryCoordinatorOutcome } from './recoveryCoordinatorTypes';
import type { ExecutionRecoveryGeneration } from './recoveryQuery';

export interface ExactRecoveryAttemptIdentity {
  runId: string;
  controlEpoch: number;
  snapshotUpdatedAtMillis: number;
  snapshotDigest: string;
  commandKind: 'reconcile_external_handles';
  commandDigest: string;
}

export type ExactRecoveryAttemptDecision =
  | { kind: 'complete'; receiptDigest: string }
  | { kind: 'retry' }
  | {
      kind: 'block';
      reason: 'generation_changed' | 'authority_changed' | 'handler_rejected' | 'handler_failed';
    }
  | { kind: 'cancel' };

interface ExactRecoveryAttemptDependencies {
  coordinate(input: {
    runId: string;
    expectedGeneration: ExecutionRecoveryGeneration;
  }): Promise<ExecutionRecoveryCoordinatorOutcome>;
}

function expectedGeneration(identity: ExactRecoveryAttemptIdentity): ExecutionRecoveryGeneration {
  return {
    controlEpoch: identity.controlEpoch,
    updatedAt: identity.snapshotUpdatedAtMillis,
    snapshotDigest: identity.snapshotDigest,
  };
}

function pointerConflicts(
  identity: ExactRecoveryAttemptIdentity,
  outcome: ExecutionRecoveryCoordinatorOutcome,
): boolean {
  return (
    (outcome.runId !== null && outcome.runId !== identity.runId) ||
    (outcome.controlEpoch !== null && outcome.controlEpoch !== identity.controlEpoch) ||
    (outcome.snapshotDigest !== null && outcome.snapshotDigest !== identity.snapshotDigest) ||
    (outcome.commandKind !== null && outcome.commandKind !== identity.commandKind) ||
    (outcome.commandDigest !== null && outcome.commandDigest !== identity.commandDigest)
  );
}

function exactSettledOutcome(
  identity: ExactRecoveryAttemptIdentity,
  outcome: Extract<ExecutionRecoveryCoordinatorOutcome, { kind: 'completed' | 'pending' }>,
): boolean {
  return (
    outcome.runId === identity.runId &&
    outcome.controlEpoch === identity.controlEpoch &&
    outcome.snapshotDigest === identity.snapshotDigest &&
    outcome.commandKind === identity.commandKind &&
    outcome.commandDigest === identity.commandDigest
  );
}

function blockReason(
  outcome: Extract<ExecutionRecoveryCoordinatorOutcome, { kind: 'blocked' }>,
): Extract<ExactRecoveryAttemptDecision, { kind: 'block' }>['reason'] {
  if (
    outcome.reason === 'revalidation_mismatch' ||
    outcome.reason === 'control_epoch_changed' ||
    outcome.sourceReason === 'generation_mismatch'
  ) {
    return 'generation_changed';
  }
  if (outcome.reason === 'invalid_authority' || outcome.reason === 'authority_revoked') {
    return 'authority_changed';
  }
  if (outcome.reason === 'handler_failed') return 'handler_failed';
  return 'handler_rejected';
}

/**
 * Runs one exact persisted generation through the production coordinator. The coordinator performs
 * the fresh journal query, cancellation/authority revalidation, and single-use dispatch fencing;
 * this function closes the resulting platform settlement decision identically on Android and iOS.
 */
export async function coordinateExactRecoveryAttempt(
  identity: ExactRecoveryAttemptIdentity,
  dependencies: ExactRecoveryAttemptDependencies,
): Promise<ExactRecoveryAttemptDecision> {
  let outcome: ExecutionRecoveryCoordinatorOutcome;
  try {
    outcome = await dependencies.coordinate({
      runId: identity.runId,
      expectedGeneration: expectedGeneration(identity),
    });
  } catch {
    return { kind: 'retry' };
  }

  if (pointerConflicts(identity, outcome)) {
    return { kind: 'block', reason: 'generation_changed' };
  }
  if (outcome.kind === 'completed' || outcome.kind === 'pending') {
    return exactSettledOutcome(identity, outcome)
      ? { kind: 'complete', receiptDigest: outcome.receiptDigest }
      : { kind: 'block', reason: 'generation_changed' };
  }
  if (outcome.kind === 'deferred') {
    return outcome.reason === 'generation_changed'
      ? { kind: 'block', reason: 'generation_changed' }
      : { kind: 'retry' };
  }
  if (outcome.reason === 'cancelled') return { kind: 'cancel' };
  return { kind: 'block', reason: blockReason(outcome) };
}
