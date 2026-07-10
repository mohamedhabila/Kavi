import type { ExecutionRecoveryCoordinatorOutcome } from './recoveryCoordinatorTypes';
import { coordinatePersistedExecutionRecovery } from './productionRecovery';
import {
  blockAndroidDurableExecution,
  cancelAndroidDurableExecution,
  completeAndroidDurableExecution,
  readAndroidDurableExecution,
  retryAndroidDurableExecution,
} from './androidDurableExecutionNative';
import type {
  AndroidDurableAdapterResult,
  AndroidDurableExecutionAttemptPointer,
  AndroidDurableExecutionPointer,
  AndroidDurableExecutionRecord,
  AndroidDurableHeadlessPayload,
} from './androidDurableExecutionTypes';
import {
  ANDROID_DURABLE_BRIDGE_SCHEMA,
  ANDROID_DURABLE_HEADLESS_TASK_KEY,
} from './androidDurableExecutionTypes';

const WORK_MANAGER_MAX_BACKOFF_MILLIS = 18_000_000;

interface AndroidRecoveryHeadlessDependencies {
  now(): number;
  coordinate(input: {
    runId: string;
    expectedGeneration: {
      controlEpoch: number;
      updatedAt: number;
      snapshotDigest: string;
    };
  }): Promise<ExecutionRecoveryCoordinatorOutcome>;
  read: typeof readAndroidDurableExecution;
  complete: typeof completeAndroidDurableExecution;
  retry: typeof retryAndroidDurableExecution;
  block: typeof blockAndroidDurableExecution;
  cancel: typeof cancelAndroidDurableExecution;
}

const DEFAULT_DEPENDENCIES: AndroidRecoveryHeadlessDependencies = {
  now: Date.now,
  coordinate: coordinatePersistedExecutionRecovery,
  read: readAndroidDurableExecution,
  complete: completeAndroidDurableExecution,
  retry: retryAndroidDurableExecution,
  block: blockAndroidDurableExecution,
  cancel: cancelAndroidDurableExecution,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
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

function validUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value)
  );
}

function validInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function decodeAndroidDurableHeadlessPayload(
  value: unknown,
): AndroidDurableHeadlessPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema',
      'workId',
      'runId',
      'controlEpoch',
      'snapshotUpdatedAtMillis',
      'snapshotDigest',
      'commandKind',
      'commandDigest',
      'attempt',
    ]) ||
    value.schema !== ANDROID_DURABLE_BRIDGE_SCHEMA ||
    !validUuid(value.workId) ||
    !validId(value.runId) ||
    !validInteger(value.controlEpoch) ||
    !validInteger(value.snapshotUpdatedAtMillis) ||
    !validDigest(value.snapshotDigest) ||
    value.commandKind !== 'reconcile_external_handles' ||
    !validDigest(value.commandDigest) ||
    !validInteger(value.attempt) ||
    value.attempt < 1
  ) {
    throw new Error('android-durable-headless-payload-invalid');
  }
  return value as unknown as AndroidDurableHeadlessPayload;
}

function generationPointer(payload: AndroidDurableHeadlessPayload): AndroidDurableExecutionPointer {
  return {
    schema: ANDROID_DURABLE_BRIDGE_SCHEMA,
    runId: payload.runId,
    controlEpoch: payload.controlEpoch,
    snapshotUpdatedAtMillis: payload.snapshotUpdatedAtMillis,
    snapshotDigest: payload.snapshotDigest,
    commandDigest: payload.commandDigest,
  };
}

function attemptPointer(
  payload: AndroidDurableHeadlessPayload,
): AndroidDurableExecutionAttemptPointer {
  const pointer = generationPointer(payload);
  const { schema: _schema, ...generation } = pointer;
  return {
    schema: ANDROID_DURABLE_BRIDGE_SCHEMA,
    generation,
    attempt: payload.attempt,
  };
}

function exactNativeRecord(
  payload: AndroidDurableHeadlessPayload,
  record: AndroidDurableExecutionRecord,
): boolean {
  const identity = record.request.identity;
  return (
    record.platformWorkId === payload.workId &&
    identity.runId === payload.runId &&
    identity.controlEpoch === payload.controlEpoch &&
    identity.snapshotUpdatedAtMillis === payload.snapshotUpdatedAtMillis &&
    identity.snapshotDigest === payload.snapshotDigest &&
    identity.commandKind === payload.commandKind &&
    identity.commandDigest === payload.commandDigest &&
    record.attempt === payload.attempt
  );
}

function exactCoordinatorOutcome(
  payload: AndroidDurableHeadlessPayload,
  outcome: Extract<ExecutionRecoveryCoordinatorOutcome, { kind: 'completed' | 'pending' }>,
): boolean {
  return (
    outcome.runId === payload.runId &&
    outcome.controlEpoch === payload.controlEpoch &&
    outcome.snapshotDigest === payload.snapshotDigest &&
    outcome.commandKind === payload.commandKind &&
    outcome.commandDigest === payload.commandDigest
  );
}

function coordinatorPointerConflicts(
  payload: AndroidDurableHeadlessPayload,
  outcome: ExecutionRecoveryCoordinatorOutcome,
): boolean {
  return (
    (outcome.runId !== null && outcome.runId !== payload.runId) ||
    (outcome.controlEpoch !== null && outcome.controlEpoch !== payload.controlEpoch) ||
    (outcome.snapshotDigest !== null && outcome.snapshotDigest !== payload.snapshotDigest) ||
    (outcome.commandKind !== null && outcome.commandKind !== payload.commandKind) ||
    (outcome.commandDigest !== null && outcome.commandDigest !== payload.commandDigest)
  );
}

function retryBackoffMillis(record: AndroidDurableExecutionRecord): number {
  let backoff = record.request.retryPolicy.initialBackoffMillis;
  for (let completedAttempts = 1; completedAttempts < record.attempt; completedAttempts += 1) {
    backoff = Math.min(backoff * 2, WORK_MANAGER_MAX_BACKOFF_MILLIS);
  }
  return backoff;
}

function safeAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function requireAcceptedReport(result: AndroidDurableAdapterResult): void {
  if (result.status !== 'accepted' && result.status !== 'no_op') {
    throw new Error(`android-durable-outcome-report-${result.status}`);
  }
}

async function reportTransientRetry(
  payload: AndroidDurableHeadlessPayload,
  record: AndroidDurableExecutionRecord,
  dependencies: AndroidRecoveryHeadlessDependencies,
  requestedRetryAt?: number,
  reason:
    | 'transient_unavailable'
    | 'remote_still_pending'
    | 'provider_temporarily_unavailable' = 'transient_unavailable',
): Promise<void> {
  const updatedAt = dependencies.now();
  const minimumRetryAt = safeAdd(updatedAt, retryBackoffMillis(record));
  const nextAttemptAt = Math.max(requestedRetryAt ?? minimumRetryAt, minimumRetryAt);
  requireAcceptedReport(
    await dependencies.retry(
      attemptPointer(payload),
      nextAttemptAt,
      reason,
      updatedAt,
    ),
  );
}

function blockReason(
  outcome: Extract<ExecutionRecoveryCoordinatorOutcome, { kind: 'blocked' }>,
): 'generation_changed' | 'authority_changed' | 'handler_rejected' | 'handler_failed' {
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

export async function runAndroidDurableRecoveryHeadlessTask(
  rawPayload: unknown,
  dependencies: AndroidRecoveryHeadlessDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const payload = decodeAndroidDurableHeadlessPayload(rawPayload);
  const nativeRead = await dependencies.read(payload.runId);
  if (nativeRead.status !== 'found' || !exactNativeRecord(payload, nativeRead.record)) {
    throw new Error('android-durable-native-generation-mismatch');
  }
  const record = nativeRead.record;
  if (record.state !== 'running') {
    return;
  }

  let outcome: ExecutionRecoveryCoordinatorOutcome;
  try {
    outcome = await dependencies.coordinate({
      runId: payload.runId,
      expectedGeneration: {
        controlEpoch: payload.controlEpoch,
        updatedAt: payload.snapshotUpdatedAtMillis,
        snapshotDigest: payload.snapshotDigest,
      },
    });
  } catch {
    await reportTransientRetry(payload, record, dependencies);
    return;
  }

  if (coordinatorPointerConflicts(payload, outcome)) {
    requireAcceptedReport(
      await dependencies.block(
        attemptPointer(payload),
        'generation_changed',
        dependencies.now(),
      ),
    );
    return;
  }

  if (outcome.kind === 'completed') {
    if (!exactCoordinatorOutcome(payload, outcome)) {
      throw new Error('android-durable-coordinator-generation-mismatch');
    }
    requireAcceptedReport(
      await dependencies.complete(attemptPointer(payload), outcome.receiptDigest, dependencies.now()),
    );
    return;
  }

  if (outcome.kind === 'pending') {
    if (!exactCoordinatorOutcome(payload, outcome)) {
      throw new Error('android-durable-coordinator-generation-mismatch');
    }
    requireAcceptedReport(
      await dependencies.complete(
        attemptPointer(payload),
        outcome.receiptDigest,
        dependencies.now(),
      ),
    );
    return;
  }

  if (outcome.kind === 'deferred') {
    if (outcome.reason === 'generation_changed') {
      requireAcceptedReport(
        await dependencies.block(
          attemptPointer(payload),
          'generation_changed',
          dependencies.now(),
        ),
      );
      return;
    }
    await reportTransientRetry(payload, record, dependencies);
    return;
  }

  if (outcome.reason === 'cancelled') {
    requireAcceptedReport(
      await dependencies.cancel(generationPointer(payload), dependencies.now()),
    );
    return;
  }
  requireAcceptedReport(
    await dependencies.block(attemptPointer(payload), blockReason(outcome), dependencies.now()),
  );
}

export function registerAndroidDurableRecoveryHeadlessTask(): void {
  const reactNative = require('react-native') as typeof import('react-native');
  if (reactNative.Platform.OS !== 'android') return;
  reactNative.AppRegistry.registerHeadlessTask(
    ANDROID_DURABLE_HEADLESS_TASK_KEY,
    () => runAndroidDurableRecoveryHeadlessTask,
  );
}
