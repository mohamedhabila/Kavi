import { Platform } from 'react-native';
import {
  cancelAndroidDurableExecution,
  readAndroidDurableExecution,
} from './androidDurableExecutionNative';
import type {
  AndroidDurableAdapterResult,
  AndroidDurableExecutionRecord,
  AndroidDurableReadResult,
} from './androidDurableExecutionTypes';
import { getDurablePlatformExecutionBridge } from './durablePlatformBridge';
import type {
  DurablePlatformAdapterResult,
  DurablePlatformExecutionBridge,
  DurablePlatformExecutionPointer,
  DurablePlatformExecutionRecord,
} from './durablePlatformBridgeTypes';
import {
  requestPersistedExecutionRecoveryCancellation,
  type RequestPersistedExecutionRecoveryCancellationInput,
  type RequestPersistedExecutionRecoveryCancellationResult,
} from './recoveryCancellation';

export type DurableRecoveryNativeCancellationOutcome =
  | { kind: 'cancelled' | 'already_cancelled' | 'not_scheduled'; runId: string }
  | { kind: 'not_supported'; runId: string; reason: 'unsupported_platform' }
  | {
      kind: 'deferred';
      runId: string;
      reason:
        | 'native_bridge_unavailable'
        | 'native_store_unavailable'
        | 'native_cancellation_deferred';
    }
  | {
      kind: 'blocked';
      runId: string;
      reason:
        | 'native_generation_changed'
        | 'native_platform_conflict'
        | 'native_timestamp_exhausted'
        | 'native_cancellation_rejected';
    };

export type RequestDurableRecoveryCancellationResult =
  | Extract<RequestPersistedExecutionRecoveryCancellationResult, { kind: 'rejected' }>
  | {
      kind: 'requested';
      receipt: Extract<
        RequestPersistedExecutionRecoveryCancellationResult,
        { kind: 'requested' }
      >['receipt'];
      native: DurableRecoveryNativeCancellationOutcome;
    };

export interface DurableRecoveryCancellationDependencies {
  platform: string;
  requestJournal(
    input: RequestPersistedExecutionRecoveryCancellationInput,
  ): Promise<RequestPersistedExecutionRecoveryCancellationResult>;
  readAndroid(runId: string): Promise<AndroidDurableReadResult>;
  cancelAndroid: typeof cancelAndroidDurableExecution;
  getIOSBridge(): DurablePlatformExecutionBridge | null;
}

const DEFAULT_DEPENDENCIES: DurableRecoveryCancellationDependencies = {
  platform: Platform.OS,
  requestJournal: requestPersistedExecutionRecoveryCancellation,
  readAndroid: readAndroidDurableExecution,
  cancelAndroid: cancelAndroidDurableExecution,
  getIOSBridge: getDurablePlatformExecutionBridge,
};

function pointer(record: DurablePlatformExecutionRecord): DurablePlatformExecutionPointer {
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

function isCancellableGeneration(
  record: DurablePlatformExecutionRecord,
  input: RequestPersistedExecutionRecoveryCancellationInput,
  cancellationUpdatedAt: number,
): boolean {
  const identity = record.request.identity;
  return (
    identity.runId === input.runId &&
    identity.controlEpoch === input.expectedGeneration.controlEpoch &&
    identity.snapshotUpdatedAtMillis <= input.expectedGeneration.updatedAt &&
    identity.snapshotUpdatedAtMillis < cancellationUpdatedAt &&
    record.request.requestedAtMillis < cancellationUpdatedAt &&
    identity.commandKind === 'reconcile_external_handles'
  );
}

function cancellationTimestamp(recordUpdatedAt: number, occurredAt: number): number | null {
  const timestamp = Math.max(recordUpdatedAt + 1, occurredAt);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function classifyAdapterResult(
  runId: string,
  result: AndroidDurableAdapterResult | DurablePlatformAdapterResult,
): DurableRecoveryNativeCancellationOutcome {
  if (result.status === 'accepted') return { kind: 'cancelled', runId };
  if (result.status === 'no_op') return { kind: 'already_cancelled', runId };
  if (result.status === 'deferred') {
    return { kind: 'deferred', runId, reason: 'native_cancellation_deferred' };
  }
  return { kind: 'blocked', runId, reason: 'native_cancellation_rejected' };
}

async function cancelAndroid(
  input: RequestPersistedExecutionRecoveryCancellationInput,
  cancellationUpdatedAt: number,
  dependencies: DurableRecoveryCancellationDependencies,
): Promise<DurableRecoveryNativeCancellationOutcome> {
  let result: AndroidDurableReadResult;
  try {
    result = await dependencies.readAndroid(input.runId);
  } catch {
    return { kind: 'deferred', runId: input.runId, reason: 'native_bridge_unavailable' };
  }
  if (result.status === 'unavailable') {
    return { kind: 'deferred', runId: input.runId, reason: 'native_store_unavailable' };
  }
  if (result.status === 'missing') return { kind: 'not_scheduled', runId: input.runId };
  if (result.status !== 'found' || result.record === null) {
    return { kind: 'deferred', runId: input.runId, reason: 'native_store_unavailable' };
  }
  return cancelExactAndroidRecord(result.record, input, cancellationUpdatedAt, dependencies);
}

async function cancelExactAndroidRecord(
  record: AndroidDurableExecutionRecord,
  input: RequestPersistedExecutionRecoveryCancellationInput,
  cancellationUpdatedAt: number,
  dependencies: DurableRecoveryCancellationDependencies,
): Promise<DurableRecoveryNativeCancellationOutcome> {
  if (!isCancellableGeneration(record, input, cancellationUpdatedAt)) {
    return { kind: 'blocked', runId: input.runId, reason: 'native_generation_changed' };
  }
  const updatedAt = cancellationTimestamp(record.updatedAtMillis, input.occurredAt);
  if (updatedAt === null) {
    return { kind: 'blocked', runId: input.runId, reason: 'native_timestamp_exhausted' };
  }
  try {
    return classifyAdapterResult(
      input.runId,
      await dependencies.cancelAndroid(pointer(record), updatedAt),
    );
  } catch {
    return { kind: 'deferred', runId: input.runId, reason: 'native_bridge_unavailable' };
  }
}

async function cancelIOS(
  input: RequestPersistedExecutionRecoveryCancellationInput,
  cancellationUpdatedAt: number,
  dependencies: DurableRecoveryCancellationDependencies,
): Promise<DurableRecoveryNativeCancellationOutcome> {
  const bridge = dependencies.getIOSBridge();
  if (!bridge) {
    return { kind: 'deferred', runId: input.runId, reason: 'native_bridge_unavailable' };
  }
  let result: Awaited<ReturnType<DurablePlatformExecutionBridge['getRecord']>>;
  try {
    result = await bridge.getRecord(input.runId);
  } catch {
    return { kind: 'deferred', runId: input.runId, reason: 'native_bridge_unavailable' };
  }
  if (result.status === 'unavailable') {
    return { kind: 'deferred', runId: input.runId, reason: 'native_store_unavailable' };
  }
  if (result.status === 'missing') return { kind: 'not_scheduled', runId: input.runId };
  if (result.status !== 'found' || result.record === null) {
    return { kind: 'deferred', runId: input.runId, reason: 'native_store_unavailable' };
  }
  if (!('taskIdentifier' in result.record)) {
    return { kind: 'blocked', runId: input.runId, reason: 'native_platform_conflict' };
  }
  if (!isCancellableGeneration(result.record, input, cancellationUpdatedAt)) {
    return { kind: 'blocked', runId: input.runId, reason: 'native_generation_changed' };
  }
  const updatedAt = cancellationTimestamp(result.record.updatedAtMillis, input.occurredAt);
  if (updatedAt === null) {
    return { kind: 'blocked', runId: input.runId, reason: 'native_timestamp_exhausted' };
  }
  try {
    return classifyAdapterResult(
      input.runId,
      await bridge.cancel(pointer(result.record), updatedAt),
    );
  } catch {
    return { kind: 'deferred', runId: input.runId, reason: 'native_bridge_unavailable' };
  }
}

/** Persist cancellation and abort its JS owner before touching the exact native generation. */
export async function requestDurableRecoveryCancellation(
  input: RequestPersistedExecutionRecoveryCancellationInput,
  dependencies: DurableRecoveryCancellationDependencies = DEFAULT_DEPENDENCIES,
): Promise<RequestDurableRecoveryCancellationResult> {
  const journal = await dependencies.requestJournal(input);
  if (journal.kind === 'rejected') return journal;

  let native: DurableRecoveryNativeCancellationOutcome;
  if (dependencies.platform === 'android') {
    native = await cancelAndroid(input, journal.receipt.updatedAt, dependencies);
  } else if (dependencies.platform === 'ios') {
    native = await cancelIOS(input, journal.receipt.updatedAt, dependencies);
  } else {
    native = { kind: 'not_supported', runId: input.runId, reason: 'unsupported_platform' };
  }
  return { ...journal, native };
}
