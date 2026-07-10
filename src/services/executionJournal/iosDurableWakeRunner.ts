import { getDurablePlatformExecutionBridge } from './durablePlatformBridge';
import type {
  DurablePlatformAdapterResult,
  DurablePlatformExecutionAttemptPointer,
  DurablePlatformExecutionBridge,
  DurablePlatformExecutionPointer,
  IOSDurablePlatformRecord,
  IOSDurableWakeEvent,
} from './durablePlatformBridgeTypes';
import type { DurableRecoveryScheduleOutcome } from './durableRecoverySchedulingTypes';
import { coordinateExactRecoveryAttempt } from './exactRecoveryAttempt';
import { continuePersistedIOSExternalRecoveryRun } from './iosDurableRecoveryScheduling';
import { coordinatePersistedExecutionRecovery } from './productionRecovery';
import {
  requestExecutionRecoveryAttention,
  type RequestExecutionRecoveryAttentionResult,
} from './recoveryAttention';
import { abortPersistedExecutionRecoveryOwner } from './recoveryCancellation';
import type { ExecutionRecoveryCoordinatorOutcome } from './recoveryCoordinatorTypes';

export type IOSDurableWakeRunnerOutcome =
  | {
      kind: 'settled';
      runId: string;
      settlement: 'completed' | 'blocked' | 'cancelled';
      continuation: DurableRecoveryScheduleOutcome;
    }
  | { kind: 'retry_scheduled'; runId: string; retryAt: number }
  | { kind: 'lease_replaced'; runId: string; continuation: DurableRecoveryScheduleOutcome }
  | { kind: 'attention_required'; runId: string }
  | { kind: 'stale'; runId: string; reason: string }
  | { kind: 'deferred' | 'blocked'; runId: string; reason: string };

interface IOSDurableWakeRunnerDependencies {
  now(): number;
  getBridge(): DurablePlatformExecutionBridge | null;
  coordinate(input: {
    runId: string;
    expectedGeneration: {
      controlEpoch: number;
      updatedAt: number;
      snapshotDigest: string;
    };
  }): Promise<ExecutionRecoveryCoordinatorOutcome>;
  continueRun(
    runId: string,
    predecessor: DurablePlatformExecutionPointer,
  ): Promise<DurableRecoveryScheduleOutcome>;
  requestAttention(input: {
    runId: string;
    expectedGeneration: {
      controlEpoch: number;
      updatedAt: number;
      snapshotDigest: string;
    };
    reason:
      | 'continued_processing_expired'
      | 'platform_retry_requires_user_action'
      | 'recovery_blocked';
    occurredAt: number;
  }): Promise<RequestExecutionRecoveryAttentionResult>;
  abortOwner(runId: string, reason?: unknown): boolean;
}

const DEFAULT_DEPENDENCIES: IOSDurableWakeRunnerDependencies = {
  now: Date.now,
  getBridge: getDurablePlatformExecutionBridge,
  coordinate: coordinatePersistedExecutionRecovery,
  continueRun: continuePersistedIOSExternalRecoveryRun,
  requestAttention: requestExecutionRecoveryAttention,
  abortOwner: abortPersistedExecutionRecoveryOwner,
};

function pointer(record: IOSDurablePlatformRecord): DurablePlatformExecutionPointer {
  const identity = record.request.identity;
  return {
    schema: 1,
    runId: identity.runId,
    controlEpoch: identity.controlEpoch,
    snapshotUpdatedAtMillis: identity.snapshotUpdatedAtMillis,
    snapshotDigest: identity.snapshotDigest,
    commandDigest: identity.commandDigest,
  };
}

function attemptPointer(record: IOSDurablePlatformRecord): DurablePlatformExecutionAttemptPointer {
  const { schema: _schema, ...generation } = pointer(record);
  return { schema: 1, generation, attempt: record.attempt };
}

function exactGeneration(left: IOSDurablePlatformRecord, right: IOSDurablePlatformRecord): boolean {
  const leftIdentity = left.request.identity;
  const rightIdentity = right.request.identity;
  return (
    leftIdentity.runId === rightIdentity.runId &&
    leftIdentity.controlEpoch === rightIdentity.controlEpoch &&
    leftIdentity.snapshotUpdatedAtMillis === rightIdentity.snapshotUpdatedAtMillis &&
    leftIdentity.snapshotDigest === rightIdentity.snapshotDigest &&
    leftIdentity.commandKind === rightIdentity.commandKind &&
    leftIdentity.commandDigest === rightIdentity.commandDigest &&
    left.taskIdentifier === right.taskIdentifier &&
    left.schedulerKind === right.schedulerKind &&
    left.state === right.state &&
    left.attempt === right.attempt &&
    left.revision === right.revision
  );
}

function isIOSRecord(
  result: Awaited<ReturnType<DurablePlatformExecutionBridge['getRecord']>>,
): result is Extract<typeof result, { status: 'found' }> & { record: IOSDurablePlatformRecord } {
  return result.status === 'found' && 'taskIdentifier' in result.record;
}

function updatedAt(record: IOSDurablePlatformRecord, now: number): number {
  return Math.max(now, record.updatedAtMillis + 1);
}

function retryAt(record: IOSDurablePlatformRecord, nextUpdatedAt: number): number {
  let backoff = record.request.retryPolicy.initialBackoffMillis;
  for (let completed = 1; completed < record.attempt; completed += 1) {
    backoff = Math.min(backoff * 2, 18_000_000);
  }
  return Math.min(Number.MAX_SAFE_INTEGER, nextUpdatedAt + backoff);
}

function expectedGeneration(record: IOSDurablePlatformRecord) {
  return {
    controlEpoch: record.request.identity.controlEpoch,
    updatedAt: record.request.identity.snapshotUpdatedAtMillis,
    snapshotDigest: record.request.identity.snapshotDigest,
  };
}

function adapterFailure(
  runId: string,
  result: DurablePlatformAdapterResult,
): Extract<IOSDurableWakeRunnerOutcome, { kind: 'deferred' | 'blocked' }> {
  if (result.status === 'deferred') return { kind: 'deferred', runId, reason: result.reason };
  return {
    kind: 'blocked',
    runId,
    reason:
      result.status === 'unsupported' || result.status === 'rejected'
        ? result.reason
        : 'native_settlement_contract_failure',
  };
}

function acceptedTerminal(
  result: DurablePlatformAdapterResult,
  source: IOSDurablePlatformRecord,
): boolean {
  return (
    (result.status === 'accepted' || result.status === 'no_op') &&
    'taskIdentifier' in result.record &&
    result.record.request.identity.runId === source.request.identity.runId &&
    result.record.request.identity.controlEpoch === source.request.identity.controlEpoch &&
    result.record.request.identity.snapshotUpdatedAtMillis ===
      source.request.identity.snapshotUpdatedAtMillis &&
    result.record.request.identity.snapshotDigest === source.request.identity.snapshotDigest &&
    result.record.request.identity.commandDigest === source.request.identity.commandDigest &&
    ['cancelled', 'completed', 'blocked'].includes(result.record.state)
  );
}

async function recordAttention(
  record: IOSDurablePlatformRecord,
  reason:
    | 'continued_processing_expired'
    | 'platform_retry_requires_user_action'
    | 'recovery_blocked',
  dependencies: IOSDurableWakeRunnerDependencies,
): Promise<RequestExecutionRecoveryAttentionResult> {
  return dependencies.requestAttention({
    runId: record.request.identity.runId,
    expectedGeneration: expectedGeneration(record),
    reason,
    occurredAt: updatedAt(record, dependencies.now()),
  });
}

async function releaseAttentionLease(
  record: IOSDurablePlatformRecord,
  bridge: DurablePlatformExecutionBridge,
): Promise<IOSDurableWakeRunnerOutcome> {
  const runId = record.request.identity.runId;
  let released: DurablePlatformAdapterResult;
  try {
    released = await bridge.releaseTerminal(pointer(record));
  } catch {
    return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
  }
  if (
    released.status === 'released' ||
    (released.status === 'rejected' && released.reason === 'record_not_found')
  ) {
    return { kind: 'attention_required', runId };
  }
  return adapterFailure(runId, released);
}

async function settleAndContinue(
  record: IOSDurablePlatformRecord,
  settlement: 'completed' | 'blocked' | 'cancelled',
  settle: () => Promise<DurablePlatformAdapterResult>,
  dependencies: IOSDurableWakeRunnerDependencies,
): Promise<IOSDurableWakeRunnerOutcome> {
  const runId = record.request.identity.runId;
  let result: DurablePlatformAdapterResult;
  try {
    result = await settle();
  } catch {
    return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
  }
  if (!acceptedTerminal(result, record)) return adapterFailure(runId, result);
  const continuation = await dependencies.continueRun(runId, pointer(record));
  return { kind: 'settled', runId, settlement, continuation };
}

/** Executes one validated iOS wake without treating the platform lease as execution authority. */
export async function runIOSDurableWakeEvent(
  event: IOSDurableWakeEvent,
  dependencies: IOSDurableWakeRunnerDependencies = DEFAULT_DEPENDENCIES,
): Promise<IOSDurableWakeRunnerOutcome> {
  const source = event.record;
  const runId = source.request.identity.runId;
  const bridge = dependencies.getBridge();
  if (!bridge) return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };

  let nativeRead: Awaited<ReturnType<DurablePlatformExecutionBridge['getRecord']>>;
  try {
    nativeRead = await bridge.getRecord(runId);
  } catch {
    return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
  }
  if (!isIOSRecord(nativeRead) || !exactGeneration(source, nativeRead.record)) {
    return { kind: 'stale', runId, reason: 'native_generation_changed' };
  }
  const record = nativeRead.record;

  if (event.disposition === 'interrupt_then_recover') {
    if (record.state !== 'expired' || record.schedulerKind !== 'background_processing') {
      return { kind: 'blocked', runId, reason: 'invalid_expiration_disposition' };
    }
    const continuation = await dependencies.continueRun(runId, pointer(record));
    return { kind: 'lease_replaced', runId, continuation };
  }

  if (event.disposition === 'require_user_action') {
    if (record.state !== 'expired' || record.schedulerKind !== 'continued_processing') {
      return { kind: 'blocked', runId, reason: 'invalid_attention_disposition' };
    }
    const attention = await recordAttention(record, 'continued_processing_expired', dependencies);
    if (attention.kind === 'recorded') return releaseAttentionLease(record, bridge);
    if (attention.reason === 'generation_changed') {
      const continuation = await dependencies.continueRun(runId, pointer(record));
      return { kind: 'lease_replaced', runId, continuation };
    }
    return { kind: 'deferred', runId, reason: attention.reason };
  }

  if (record.state !== 'running') {
    return { kind: 'stale', runId, reason: 'native_attempt_not_running' };
  }
  if (record.request.identity.commandKind !== 'reconcile_external_handles') {
    return { kind: 'blocked', runId, reason: 'unsupported_recovery_command' };
  }
  const decision = await coordinateExactRecoveryAttempt(
    {
      ...record.request.identity,
      commandKind: 'reconcile_external_handles',
    },
    {
      coordinate: dependencies.coordinate,
    },
  );
  const nextUpdatedAt = updatedAt(record, dependencies.now());

  if (decision.kind === 'complete') {
    return settleAndContinue(
      record,
      'completed',
      () => bridge.complete(attemptPointer(record), decision.receiptDigest, nextUpdatedAt),
      dependencies,
    );
  }

  if (decision.kind === 'retry') {
    if (record.schedulerKind === 'continued_processing') {
      const attention = await recordAttention(
        record,
        'platform_retry_requires_user_action',
        dependencies,
      );
      if (attention.kind === 'rejected' && attention.reason !== 'generation_changed') {
        return { kind: 'deferred', runId, reason: attention.reason };
      }
      return settleAndContinue(
        record,
        'blocked',
        () => bridge.block(attemptPointer(record), 'handler_failed', nextUpdatedAt),
        dependencies,
      );
    }
    const nextRetryAt = retryAt(record, nextUpdatedAt);
    let scheduled: DurablePlatformAdapterResult;
    try {
      scheduled = await bridge.scheduleRetry(
        attemptPointer(record),
        nextRetryAt,
        'transient_unavailable',
        nextUpdatedAt,
      );
    } catch {
      return { kind: 'deferred', runId, reason: 'native_bridge_unavailable' };
    }
    if (scheduled.status !== 'accepted' && scheduled.status !== 'no_op') {
      return adapterFailure(runId, scheduled);
    }
    return { kind: 'retry_scheduled', runId, retryAt: nextRetryAt };
  }

  if (decision.kind === 'cancel') {
    dependencies.abortOwner(runId, 'Durable recovery was cancelled.');
    return settleAndContinue(
      record,
      'cancelled',
      () => bridge.cancel(pointer(record), nextUpdatedAt),
      dependencies,
    );
  }

  if (decision.reason !== 'generation_changed') {
    const attention = await recordAttention(record, 'recovery_blocked', dependencies);
    if (attention.kind === 'rejected' && attention.reason !== 'generation_changed') {
      return { kind: 'deferred', runId, reason: attention.reason };
    }
  }
  return settleAndContinue(
    record,
    'blocked',
    () => bridge.block(attemptPointer(record), decision.reason, nextUpdatedAt),
    dependencies,
  );
}
