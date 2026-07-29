import type {
  AndroidDurableAdapterResult,
  AndroidDurableExecutionAttemptPointer,
  AndroidDurableExecutionPointer,
  AndroidDurableExecutionRecord,
  AndroidDurableFailureReason,
  AndroidDurableCandidateWakeOutcome,
  AndroidDurableReadResult,
  AndroidExternalDurableExecutionRequest,
} from './androidDurableExecutionTypes';
import {
  ANDROID_DURABLE_BRIDGE_SCHEMA,
  ANDROID_DURABLE_CANDIDATE_TASK_KEY,
  ANDROID_DURABLE_HEADLESS_TASK_KEY,
} from './androidDurableExecutionTypes';

interface KaviDurableExecutionNativeModule {
  bridgeSchema: unknown;
  headlessTaskKey: unknown;
  candidateTaskKey: unknown;
  enqueue(request: AndroidExternalDurableExecutionRequest): Promise<unknown>;
  cancel(pointer: AndroidDurableExecutionPointer, updatedAtMillis: number): Promise<unknown>;
  complete(
    pointer: AndroidDurableExecutionAttemptPointer,
    receiptDigest: string,
    updatedAtMillis: number,
  ): Promise<unknown>;
  scheduleRetry(
    pointer: AndroidDurableExecutionAttemptPointer,
    nextAttemptAtMillis: number,
    failureReason: AndroidDurableFailureReason,
    updatedAtMillis: number,
  ): Promise<unknown>;
  block(
    pointer: AndroidDurableExecutionAttemptPointer,
    failureReason: AndroidDurableFailureReason,
    updatedAtMillis: number,
  ): Promise<unknown>;
  releaseTerminal(pointer: AndroidDurableExecutionPointer): Promise<unknown>;
  getRecord(runId: string): Promise<unknown>;
  acknowledgeCandidateWake(
    wakeWorkId: string,
    predecessorWorkId: string,
    runId: string,
    outcome: AndroidDurableCandidateWakeOutcome,
  ): Promise<unknown>;
}

const EXECUTION_STATES = [
  'scheduling',
  'enqueued',
  'running',
  'retry_waiting',
  'cancel_requested',
  'cancelled',
  'completed',
  'blocked',
] as const;

const FAILURE_REASONS = [
  'transient_unavailable',
  'remote_still_pending',
  'provider_temporarily_unavailable',
  'generation_changed',
  'authority_changed',
  'handler_rejected',
  'handler_failed',
  'retry_exhausted',
  'platform_terminated_without_receipt',
] as const;

const ADAPTER_FAILURE_REASONS = [
  'invalid_request',
  'process_bound_interactive_work',
  'no_general_agent_foreground_service_contract',
  'missing_event_trigger_contract',
  'missing_required_network_constraint',
  'device_idle_backoff_unsupported',
  'unsafe_recovery_command',
  'stale_control_epoch',
  'command_identity_conflict',
  'request_contract_conflict',
  'active_older_generation',
  'terminal_generation',
  'record_not_found',
  'invalid_progress_transition',
  'invalid_progress',
  'stale_attempt',
  'store_unavailable',
  'store_conflict',
  'scheduler_unavailable',
  'scheduler_conflict',
] as const;

function getReactNativeRuntime(): typeof import('react-native') {
  return require('react-native') as typeof import('react-native');
}

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

function validNullableInteger(value: unknown): value is number | null {
  return value === null || validInteger(value);
}

function validNullableDigest(value: unknown): value is string | null {
  return value === null || validDigest(value);
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number]);
}

function decodeRequest(value: unknown): AndroidExternalDurableExecutionRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema',
      'durabilityClass',
      'identity',
      'constraints',
      'retryPolicy',
      'requestedAtMillis',
    ]) ||
    value.schema !== ANDROID_DURABLE_BRIDGE_SCHEMA ||
    value.durabilityClass !== 'external_durable_operation' ||
    !validInteger(value.requestedAtMillis) ||
    !isRecord(value.identity) ||
    !hasExactKeys(value.identity, [
      'runId',
      'controlEpoch',
      'snapshotUpdatedAtMillis',
      'snapshotDigest',
      'commandKind',
      'commandDigest',
    ]) ||
    !validId(value.identity.runId) ||
    !validInteger(value.identity.controlEpoch) ||
    !validInteger(value.identity.snapshotUpdatedAtMillis) ||
    !validDigest(value.identity.snapshotDigest) ||
    value.identity.commandKind !== 'reconcile_external_handles' ||
    !validDigest(value.identity.commandDigest) ||
    !isRecord(value.constraints) ||
    !hasExactKeys(value.constraints, [
      'network',
      'requiresCharging',
      'requiresBatteryNotLow',
      'requiresStorageNotLow',
      'requiresDeviceIdle',
      'earliestStartAtMillis',
    ]) ||
    (value.constraints.network !== 'connected' && value.constraints.network !== 'unmetered') ||
    typeof value.constraints.requiresCharging !== 'boolean' ||
    typeof value.constraints.requiresBatteryNotLow !== 'boolean' ||
    typeof value.constraints.requiresStorageNotLow !== 'boolean' ||
    value.constraints.requiresDeviceIdle !== false ||
    !validInteger(value.constraints.earliestStartAtMillis) ||
    !isRecord(value.retryPolicy) ||
    !hasExactKeys(value.retryPolicy, ['maxAttempts', 'backoffPolicy', 'initialBackoffMillis']) ||
    !validInteger(value.retryPolicy.maxAttempts) ||
    value.retryPolicy.backoffPolicy !== 'exponential' ||
    !validInteger(value.retryPolicy.initialBackoffMillis)
  ) {
    throw new Error('android-durable-native-contract-violation');
  }
  return value as unknown as AndroidExternalDurableExecutionRequest;
}

function decodeRecord(value: unknown): AndroidDurableExecutionRecord {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'request',
      'schedulerKind',
      'uniqueWorkName',
      'platformWorkId',
      'state',
      'attempt',
      'nextAttemptAtMillis',
      'failureReason',
      'receiptDigest',
      'revision',
      'updatedAtMillis',
    ]) ||
    value.schedulerKind !== 'work_manager_one_time' ||
    !validId(value.uniqueWorkName) ||
    !validUuid(value.platformWorkId) ||
    !includes(EXECUTION_STATES, value.state) ||
    !validInteger(value.attempt) ||
    !validNullableInteger(value.nextAttemptAtMillis) ||
    !(value.failureReason === null || includes(FAILURE_REASONS, value.failureReason)) ||
    !validNullableDigest(value.receiptDigest) ||
    !validInteger(value.revision) ||
    !validInteger(value.updatedAtMillis)
  ) {
    throw new Error('android-durable-native-contract-violation');
  }
  return {
    ...(value as unknown as Omit<AndroidDurableExecutionRecord, 'request'>),
    request: decodeRequest(value.request),
  };
}

function decodeAdapterResult(value: unknown): AndroidDurableAdapterResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'status', 'reason', 'record']) ||
    value.schema !== ANDROID_DURABLE_BRIDGE_SCHEMA
  ) {
    throw new Error('android-durable-native-contract-violation');
  }
  if (value.status === 'accepted' || value.status === 'no_op' || value.status === 'released') {
    if (value.reason !== null) throw new Error('android-durable-native-contract-violation');
    return {
      schema: ANDROID_DURABLE_BRIDGE_SCHEMA,
      status: value.status,
      reason: null,
      record: decodeRecord(value.record),
    };
  }
  if (
    (value.status === 'unsupported' ||
      value.status === 'rejected' ||
      value.status === 'deferred') &&
    includes(ADAPTER_FAILURE_REASONS, value.reason) &&
    value.record === null
  ) {
    return value as unknown as AndroidDurableAdapterResult;
  }
  throw new Error('android-durable-native-contract-violation');
}

function decodeReadResult(value: unknown): AndroidDurableReadResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'status', 'record']) ||
    value.schema !== ANDROID_DURABLE_BRIDGE_SCHEMA
  ) {
    throw new Error('android-durable-native-contract-violation');
  }
  if (value.status === 'found') {
    return {
      schema: ANDROID_DURABLE_BRIDGE_SCHEMA,
      status: 'found',
      record: decodeRecord(value.record),
    };
  }
  if ((value.status === 'missing' || value.status === 'unavailable') && value.record === null) {
    return value as unknown as AndroidDurableReadResult;
  }
  throw new Error('android-durable-native-contract-violation');
}

function getNativeModule(): KaviDurableExecutionNativeModule {
  const reactNative = getReactNativeRuntime();
  if (reactNative.Platform.OS !== 'android') {
    throw new Error('android-durable-execution-unsupported-platform');
  }
  const module = reactNative.NativeModules.KaviDurableExecution as
    | KaviDurableExecutionNativeModule
    | undefined;
  if (
    !module ||
    module.bridgeSchema !== ANDROID_DURABLE_BRIDGE_SCHEMA ||
    module.headlessTaskKey !== ANDROID_DURABLE_HEADLESS_TASK_KEY ||
    module.candidateTaskKey !== ANDROID_DURABLE_CANDIDATE_TASK_KEY ||
    typeof module.enqueue !== 'function' ||
    typeof module.cancel !== 'function' ||
    typeof module.complete !== 'function' ||
    typeof module.scheduleRetry !== 'function' ||
    typeof module.block !== 'function' ||
    typeof module.releaseTerminal !== 'function' ||
    typeof module.getRecord !== 'function' ||
    typeof module.acknowledgeCandidateWake !== 'function'
  ) {
    throw new Error('android-durable-execution-native-module-unavailable');
  }
  return module;
}

export function isAndroidDurableExecutionAvailable(): boolean {
  try {
    getNativeModule();
    return true;
  } catch {
    return false;
  }
}

export async function enqueueAndroidDurableExecution(
  request: AndroidExternalDurableExecutionRequest,
): Promise<AndroidDurableAdapterResult> {
  return decodeAdapterResult(await getNativeModule().enqueue(request));
}

export async function cancelAndroidDurableExecution(
  pointer: AndroidDurableExecutionPointer,
  updatedAtMillis: number,
): Promise<AndroidDurableAdapterResult> {
  return decodeAdapterResult(await getNativeModule().cancel(pointer, updatedAtMillis));
}

export async function completeAndroidDurableExecution(
  pointer: AndroidDurableExecutionAttemptPointer,
  receiptDigest: string,
  updatedAtMillis: number,
): Promise<AndroidDurableAdapterResult> {
  return decodeAdapterResult(
    await getNativeModule().complete(pointer, receiptDigest, updatedAtMillis),
  );
}

export async function retryAndroidDurableExecution(
  pointer: AndroidDurableExecutionAttemptPointer,
  nextAttemptAtMillis: number,
  failureReason: Extract<
    AndroidDurableFailureReason,
    'transient_unavailable' | 'remote_still_pending' | 'provider_temporarily_unavailable'
  >,
  updatedAtMillis: number,
): Promise<AndroidDurableAdapterResult> {
  return decodeAdapterResult(
    await getNativeModule().scheduleRetry(
      pointer,
      nextAttemptAtMillis,
      failureReason,
      updatedAtMillis,
    ),
  );
}

export async function blockAndroidDurableExecution(
  pointer: AndroidDurableExecutionAttemptPointer,
  failureReason: Extract<
    AndroidDurableFailureReason,
    'generation_changed' | 'authority_changed' | 'handler_rejected' | 'handler_failed'
  >,
  updatedAtMillis: number,
): Promise<AndroidDurableAdapterResult> {
  return decodeAdapterResult(
    await getNativeModule().block(pointer, failureReason, updatedAtMillis),
  );
}

export async function releaseTerminalAndroidDurableExecution(
  pointer: AndroidDurableExecutionPointer,
): Promise<AndroidDurableAdapterResult> {
  return decodeAdapterResult(await getNativeModule().releaseTerminal(pointer));
}

export async function readAndroidDurableExecution(
  runId: string,
): Promise<AndroidDurableReadResult> {
  return decodeReadResult(await getNativeModule().getRecord(runId));
}

export async function acknowledgeAndroidDurableCandidateWake(
  wakeWorkId: string,
  predecessorWorkId: string,
  runId: string,
  outcome: AndroidDurableCandidateWakeOutcome,
): Promise<void> {
  const acknowledged = await getNativeModule().acknowledgeCandidateWake(
    wakeWorkId,
    predecessorWorkId,
    runId,
    outcome,
  );
  if (acknowledged !== true) {
    throw new Error('android-durable-candidate-acknowledgement-rejected');
  }
}
