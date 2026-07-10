import {
  DURABLE_PLATFORM_BRIDGE_SCHEMA,
  type AndroidDurablePlatformRecord,
  type DurablePlatformAdapterResult,
  type DurablePlatformExecutionRecord,
  type DurablePlatformExecutionRequest,
  type DurablePlatformOutboxResult,
  type DurablePlatformOutboxSide,
  type DurablePlatformReadResult,
  type IOSDurablePendingLaunches,
  type IOSDurablePlatformRecord,
  type IOSDurableWakeEvent,
} from './durablePlatformBridgeTypes';

const DURABILITY_CLASSES = new Set([
  'foreground_interactive',
  'user_initiated_continuable',
  'deferrable_maintenance',
  'event_driven_monitor',
  'external_durable_operation',
]);
const COMMAND_KINDS = new Set([
  'resume_model_step',
  'resume_persisted_tool_batch',
  'continue_after_tool_result',
  'reconcile_external_handles',
  'resume_review',
  'finalize_existing_terminal_projection',
]);
const NETWORK_CONSTRAINTS = new Set(['not_required', 'connected', 'unmetered']);
const RECORD_STATES = new Set([
  'scheduling',
  'enqueued',
  'submitted',
  'running',
  'retry_waiting',
  'cancel_requested',
  'cancelled',
  'completed',
  'expired',
  'blocked',
]);
const FAILURE_REASONS = new Set([
  'transient_unavailable',
  'remote_still_pending',
  'provider_temporarily_unavailable',
  'generation_changed',
  'authority_changed',
  'handler_rejected',
  'handler_failed',
  'retry_exhausted',
  'platform_expired',
  'continued_processing_interrupted',
  'platform_request_missing',
  'platform_terminated_without_receipt',
]);
const RETRYABLE_FAILURE_REASONS = new Set([
  'transient_unavailable',
  'remote_still_pending',
  'provider_temporarily_unavailable',
]);
const IOS_INTERRUPTION_REASONS = new Set([
  'platform_expired',
  'continued_processing_interrupted',
  'platform_request_missing',
]);
const UNSUPPORTED_REASONS = new Set([
  'invalid_request',
  'process_bound_interactive_work',
  'no_general_agent_foreground_service_contract',
  'continued_processing_unavailable',
  'foreground_user_action_required',
  'stale_request_timestamp',
  'continued_processing_delay_unsupported',
  'unsupported_network_constraint',
  'unsupported_platform_constraint',
  'missing_event_trigger_contract',
  'missing_required_network_constraint',
  'device_idle_backoff_unsupported',
  'unsafe_recovery_command',
]);
const REJECTION_REASONS = new Set([
  'stale_control_epoch',
  'command_identity_conflict',
  'request_contract_conflict',
  'active_older_generation',
  'terminal_generation',
  'record_not_found',
  'invalid_progress_transition',
  'invalid_progress',
  'invalid_checkpoint',
  'stale_attempt',
  'continued_retry_requires_user_action',
  'platform_terminated_without_receipt',
]);
const DEFER_REASONS = new Set([
  'store_unavailable',
  'store_conflict',
  'scheduler_unavailable',
  'scheduler_conflict',
]);

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

function validUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)
  );
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullable<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
): value is T | null {
  return value === null || predicate(value);
}

function validRequest(value: unknown): value is DurablePlatformExecutionRequest {
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
    value.schema !== DURABLE_PLATFORM_BRIDGE_SCHEMA ||
    typeof value.durabilityClass !== 'string' ||
    !DURABILITY_CLASSES.has(value.durabilityClass) ||
    !safeInteger(value.requestedAtMillis)
  ) {
    return false;
  }
  const identity = value.identity;
  const constraints = value.constraints;
  const retry = value.retryPolicy;
  return (
    isRecord(identity) &&
    hasExactKeys(identity, [
      'runId',
      'controlEpoch',
      'snapshotUpdatedAtMillis',
      'snapshotDigest',
      'commandKind',
      'commandDigest',
    ]) &&
    validId(identity.runId) &&
    safeInteger(identity.controlEpoch) &&
    safeInteger(identity.snapshotUpdatedAtMillis) &&
    validDigest(identity.snapshotDigest) &&
    typeof identity.commandKind === 'string' &&
    COMMAND_KINDS.has(identity.commandKind) &&
    validDigest(identity.commandDigest) &&
    identity.snapshotUpdatedAtMillis <= value.requestedAtMillis &&
    isRecord(constraints) &&
    hasExactKeys(constraints, [
      'network',
      'requiresCharging',
      'requiresBatteryNotLow',
      'requiresStorageNotLow',
      'requiresDeviceIdle',
      'earliestStartAtMillis',
    ]) &&
    typeof constraints.network === 'string' &&
    NETWORK_CONSTRAINTS.has(constraints.network) &&
    typeof constraints.requiresCharging === 'boolean' &&
    typeof constraints.requiresBatteryNotLow === 'boolean' &&
    typeof constraints.requiresStorageNotLow === 'boolean' &&
    typeof constraints.requiresDeviceIdle === 'boolean' &&
    safeInteger(constraints.earliestStartAtMillis) &&
    constraints.earliestStartAtMillis >= value.requestedAtMillis &&
    isRecord(retry) &&
    hasExactKeys(retry, ['maxAttempts', 'backoffPolicy', 'initialBackoffMillis']) &&
    safeInteger(retry.maxAttempts) &&
    retry.maxAttempts >= 1 &&
    retry.maxAttempts <= 10 &&
    retry.backoffPolicy === 'exponential' &&
    safeInteger(retry.initialBackoffMillis) &&
    retry.initialBackoffMillis >= 10_000 &&
    retry.initialBackoffMillis <= 18_000_000
  );
}

function validRecordBase(value: Record<string, unknown>): boolean {
  if (!validRequest(value.request)) {
    return false;
  }
  const request = value.request;
  return (
    typeof value.state === 'string' &&
    RECORD_STATES.has(value.state) &&
    safeInteger(value.attempt) &&
    value.attempt <= request.retryPolicy.maxAttempts &&
    nullable(value.nextAttemptAtMillis, safeInteger) &&
    (value.failureReason === null ||
      (typeof value.failureReason === 'string' && FAILURE_REASONS.has(value.failureReason))) &&
    nullable(value.receiptDigest, validDigest) &&
    safeInteger(value.revision) &&
    safeInteger(value.updatedAtMillis) &&
    value.updatedAtMillis >= request.requestedAtMillis &&
    request.identity.snapshotUpdatedAtMillis <= value.updatedAtMillis &&
    (value.nextAttemptAtMillis === null || value.nextAttemptAtMillis >= value.updatedAtMillis)
  );
}

function validIOSRequest(
  request: DurablePlatformExecutionRequest,
  schedulerKind: unknown,
): boolean {
  const { constraints, identity } = request;
  if (
    identity.commandKind !== 'reconcile_external_handles' ||
    constraints.requiresBatteryNotLow ||
    constraints.requiresStorageNotLow ||
    constraints.requiresDeviceIdle
  ) {
    return false;
  }
  if (schedulerKind === 'continued_processing') {
    return (
      request.durabilityClass === 'user_initiated_continuable' &&
      constraints.network === 'not_required' &&
      !constraints.requiresCharging &&
      constraints.earliestStartAtMillis === request.requestedAtMillis
    );
  }
  return (
    schedulerKind === 'background_processing' &&
    request.durabilityClass === 'external_durable_operation' &&
    constraints.network === 'connected'
  );
}

function validAndroidRequest(request: DurablePlatformExecutionRequest): boolean {
  return (
    request.durabilityClass === 'external_durable_operation' &&
    request.identity.commandKind === 'reconcile_external_handles' &&
    (request.constraints.network === 'connected' || request.constraints.network === 'unmetered') &&
    request.constraints.requiresDeviceIdle === false
  );
}

function minimumRetryAt(value: Record<string, unknown>): number {
  const request = value.request as DurablePlatformExecutionRequest;
  let backoff = request.retryPolicy.initialBackoffMillis;
  for (
    let completedAttempts = 1;
    completedAttempts < (value.attempt as number);
    completedAttempts += 1
  ) {
    backoff = Math.min(backoff * 2, 18_000_000);
  }
  return Math.min(Number.MAX_SAFE_INTEGER, (value.updatedAtMillis as number) + backoff);
}

function hasNoOutcome(value: Record<string, unknown>): boolean {
  return (
    value.nextAttemptAtMillis === null &&
    value.failureReason === null &&
    value.receiptDigest === null
  );
}

function validIOSState(value: Record<string, unknown>): boolean {
  const attempt = value.attempt as number;
  const request = value.request as DurablePlatformExecutionRequest;
  switch (value.state) {
    case 'scheduling':
    case 'submitted':
      return attempt === 0 && hasNoOutcome(value);
    case 'running':
      return attempt >= 1 && hasNoOutcome(value);
    case 'retry_waiting':
      return (
        attempt >= 1 &&
        attempt < request.retryPolicy.maxAttempts &&
        typeof value.nextAttemptAtMillis === 'number' &&
        value.nextAttemptAtMillis >= minimumRetryAt(value) &&
        typeof value.failureReason === 'string' &&
        RETRYABLE_FAILURE_REASONS.has(value.failureReason) &&
        value.receiptDigest === null
      );
    case 'cancel_requested':
      return value.receiptDigest === null;
    case 'cancelled':
      return hasNoOutcome(value);
    case 'completed':
      return (
        attempt >= 1 &&
        value.nextAttemptAtMillis === null &&
        value.failureReason === null &&
        validDigest(value.receiptDigest)
      );
    case 'expired':
      return (
        value.nextAttemptAtMillis === null &&
        typeof value.failureReason === 'string' &&
        IOS_INTERRUPTION_REASONS.has(value.failureReason) &&
        value.receiptDigest === null
      );
    case 'blocked':
      return (
        value.nextAttemptAtMillis === null &&
        typeof value.failureReason === 'string' &&
        FAILURE_REASONS.has(value.failureReason) &&
        value.receiptDigest === null
      );
    default:
      return false;
  }
}

function validAndroidState(value: Record<string, unknown>): boolean {
  const attempt = value.attempt as number;
  const request = value.request as DurablePlatformExecutionRequest;
  switch (value.state) {
    case 'scheduling':
    case 'enqueued':
      return attempt === 0 && hasNoOutcome(value);
    case 'running':
      return attempt >= 1 && hasNoOutcome(value);
    case 'retry_waiting':
      return (
        attempt >= 1 &&
        attempt < request.retryPolicy.maxAttempts &&
        typeof value.nextAttemptAtMillis === 'number' &&
        value.nextAttemptAtMillis >= minimumRetryAt(value) &&
        typeof value.failureReason === 'string' &&
        RETRYABLE_FAILURE_REASONS.has(value.failureReason) &&
        value.receiptDigest === null
      );
    case 'cancel_requested':
    case 'cancelled':
      return hasNoOutcome(value);
    case 'completed':
      return (
        attempt >= 1 &&
        value.nextAttemptAtMillis === null &&
        value.failureReason === null &&
        validDigest(value.receiptDigest)
      );
    case 'blocked':
      return (
        value.nextAttemptAtMillis === null &&
        typeof value.failureReason === 'string' &&
        FAILURE_REASONS.has(value.failureReason) &&
        !RETRYABLE_FAILURE_REASONS.has(value.failureReason) &&
        value.receiptDigest === null
      );
    default:
      return false;
  }
}

function validIOSProgress(value: Record<string, unknown>): boolean {
  if (value.progressCompleted === null && value.progressTotal === null) {
    return true;
  }
  return (
    safeInteger(value.progressCompleted) &&
    safeInteger(value.progressTotal) &&
    value.progressTotal > 0 &&
    value.progressCompleted <= value.progressTotal
  );
}

function validIOSCheckpoint(value: Record<string, unknown>): boolean {
  return (
    value.lastCheckpointAtMillis === null ||
    (safeInteger(value.lastCheckpointAtMillis) &&
      isRecord(value.request) &&
      safeInteger(value.request.requestedAtMillis) &&
      safeInteger(value.updatedAtMillis) &&
      value.lastCheckpointAtMillis >= value.request.requestedAtMillis &&
      value.lastCheckpointAtMillis <= value.updatedAtMillis)
  );
}

function parseRecord(value: unknown): DurablePlatformExecutionRecord {
  if (!isRecord(value) || !validRecordBase(value)) {
    throw new Error('durable-platform-bridge-invalid-record');
  }
  if (
    hasExactKeys(value, [
      'request',
      'schedulerKind',
      'taskIdentifier',
      'state',
      'attempt',
      'nextAttemptAtMillis',
      'failureReason',
      'receiptDigest',
      'progressCompleted',
      'progressTotal',
      'lastCheckpointAtMillis',
      'revision',
      'updatedAtMillis',
    ]) &&
    (value.schedulerKind === 'continued_processing' ||
      value.schedulerKind === 'background_processing') &&
    validId(value.taskIdentifier) &&
    validIOSProgress(value) &&
    validIOSCheckpoint(value) &&
    validIOSRequest(value.request as DurablePlatformExecutionRequest, value.schedulerKind) &&
    validIOSState(value)
  ) {
    return value as unknown as IOSDurablePlatformRecord;
  }
  if (
    hasExactKeys(value, [
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
    ]) &&
    value.schedulerKind === 'work_manager_one_time' &&
    validId(value.uniqueWorkName) &&
    validUuid(value.platformWorkId) &&
    validAndroidRequest(value.request as DurablePlatformExecutionRequest) &&
    validAndroidState(value)
  ) {
    return value as unknown as AndroidDurablePlatformRecord;
  }
  throw new Error('durable-platform-bridge-invalid-record');
}

export function parseDurablePlatformAdapterResult(value: unknown): DurablePlatformAdapterResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'status', 'reason', 'record']) ||
    value.schema !== DURABLE_PLATFORM_BRIDGE_SCHEMA ||
    typeof value.status !== 'string'
  ) {
    throw new Error('durable-platform-bridge-invalid-result');
  }
  if (value.status === 'accepted' || value.status === 'no_op' || value.status === 'released') {
    if (value.reason !== null) throw new Error('durable-platform-bridge-invalid-result');
    return { ...value, record: parseRecord(value.record) } as DurablePlatformAdapterResult;
  }
  const reasonSet =
    value.status === 'unsupported'
      ? UNSUPPORTED_REASONS
      : value.status === 'rejected'
        ? REJECTION_REASONS
        : value.status === 'deferred'
          ? DEFER_REASONS
          : null;
  if (
    reasonSet &&
    typeof value.reason === 'string' &&
    reasonSet.has(value.reason) &&
    value.record === null
  ) {
    return value as DurablePlatformAdapterResult;
  }
  throw new Error('durable-platform-bridge-invalid-result');
}

export function parseDurablePlatformReadResult(value: unknown): DurablePlatformReadResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'status', 'record']) ||
    value.schema !== DURABLE_PLATFORM_BRIDGE_SCHEMA
  ) {
    throw new Error('durable-platform-bridge-invalid-read');
  }
  if (value.status === 'found') {
    return { ...value, record: parseRecord(value.record) } as DurablePlatformReadResult;
  }
  if ((value.status === 'missing' || value.status === 'unavailable') && value.record === null) {
    return value as DurablePlatformReadResult;
  }
  throw new Error('durable-platform-bridge-invalid-read');
}

export function parseIOSDurableWakeEvent(value: unknown): IOSDurableWakeEvent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'trigger', 'disposition', 'record']) ||
    value.schema !== DURABLE_PLATFORM_BRIDGE_SCHEMA ||
    !['platform_launch', 'platform_expiration', 'relaunch_reconciliation'].includes(
      String(value.trigger),
    ) ||
    !['recover', 'interrupt_then_recover', 'require_user_action'].includes(
      String(value.disposition),
    )
  ) {
    throw new Error('durable-platform-bridge-invalid-wake');
  }
  const record = parseRecord(value.record);
  if (!('taskIdentifier' in record)) {
    throw new Error('durable-platform-bridge-invalid-wake');
  }
  if (
    (value.trigger === 'platform_launch' && record.state !== 'running') ||
    (value.trigger === 'platform_expiration' && record.state !== 'expired') ||
    (value.trigger === 'relaunch_reconciliation' &&
      record.state !== 'running' &&
      record.state !== 'expired')
  ) {
    throw new Error('durable-platform-bridge-invalid-wake');
  }
  const expectedDisposition =
    record.state === 'expired' && record.schedulerKind === 'continued_processing'
      ? 'require_user_action'
      : record.state === 'expired' && record.schedulerKind === 'background_processing'
        ? 'interrupt_then_recover'
        : 'recover';
  if (value.disposition !== expectedDisposition) {
    throw new Error('durable-platform-bridge-invalid-wake');
  }
  return { ...value, record } as IOSDurableWakeEvent;
}

export function parseIOSDurablePendingLaunches(value: unknown): IOSDurablePendingLaunches {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'status', 'events']) ||
    value.schema !== DURABLE_PLATFORM_BRIDGE_SCHEMA ||
    !Array.isArray(value.events)
  ) {
    throw new Error('durable-platform-bridge-invalid-pending');
  }
  if (value.status === 'unavailable' && value.events.length === 0) {
    return value as IOSDurablePendingLaunches;
  }
  if (value.status === 'available') {
    const events = value.events.map(parseIOSDurableWakeEvent);
    const runIds = events.map((event) => event.record.request.identity.runId);
    if (events.length > 1_000 || new Set(runIds).size !== runIds.length) {
      throw new Error('durable-platform-bridge-invalid-pending');
    }
    return {
      schema: DURABLE_PLATFORM_BRIDGE_SCHEMA,
      status: 'available',
      events,
    };
  }
  throw new Error('durable-platform-bridge-invalid-pending');
}

function parseOutboxSide(value: unknown): DurablePlatformOutboxSide {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['status', 'outcomes']) ||
    !Array.isArray(value.outcomes)
  ) {
    throw new Error('durable-platform-bridge-invalid-outbox');
  }
  if (value.status === 'store_unavailable' && value.outcomes.length === 0) {
    return value as DurablePlatformOutboxSide;
  }
  if (value.status !== 'completed') {
    throw new Error('durable-platform-bridge-invalid-outbox');
  }
  const outcomes = value.outcomes.map((outcome) => {
    if (
      !isRecord(outcome) ||
      !hasExactKeys(outcome, ['runId', 'result']) ||
      !validId(outcome.runId)
    ) {
      throw new Error('durable-platform-bridge-invalid-outbox');
    }
    return { runId: outcome.runId, result: parseDurablePlatformAdapterResult(outcome.result) };
  });
  if (
    outcomes.length > 1_000 ||
    new Set(outcomes.map(({ runId }) => runId)).size !== outcomes.length
  ) {
    throw new Error('durable-platform-bridge-invalid-outbox');
  }
  return {
    status: 'completed',
    outcomes,
  };
}

export function parseDurablePlatformOutboxResult(value: unknown): DurablePlatformOutboxResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'scheduling', 'cancellation']) ||
    value.schema !== DURABLE_PLATFORM_BRIDGE_SCHEMA
  ) {
    throw new Error('durable-platform-bridge-invalid-outbox');
  }
  return {
    schema: DURABLE_PLATFORM_BRIDGE_SCHEMA,
    scheduling: parseOutboxSide(value.scheduling),
    cancellation: parseOutboxSide(value.cancellation),
  };
}
