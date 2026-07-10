import type { ExecutionDurabilityClass } from './types';
import type { DispatchableExecutionRecoveryCommandKind } from './recoveryCoordinatorTypes';

export const DURABLE_PLATFORM_BRIDGE_SCHEMA = 1 as const;

export type DurablePlatformNetworkConstraint = 'not_required' | 'connected' | 'unmetered';
export type DurablePlatformBackoffPolicy = 'exponential';

export interface DurablePlatformRecoveryIdentity {
  runId: string;
  controlEpoch: number;
  snapshotUpdatedAtMillis: number;
  snapshotDigest: string;
  commandKind: DispatchableExecutionRecoveryCommandKind;
  commandDigest: string;
}

export interface DurablePlatformExecutionRequest {
  schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
  durabilityClass: ExecutionDurabilityClass;
  identity: DurablePlatformRecoveryIdentity;
  constraints: {
    network: DurablePlatformNetworkConstraint;
    requiresCharging: boolean;
    requiresBatteryNotLow: boolean;
    requiresStorageNotLow: boolean;
    requiresDeviceIdle: boolean;
    earliestStartAtMillis: number;
  };
  retryPolicy: {
    maxAttempts: number;
    backoffPolicy: DurablePlatformBackoffPolicy;
    initialBackoffMillis: number;
  };
  requestedAtMillis: number;
}

export interface DurablePlatformExecutionPointer {
  schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
  runId: string;
  controlEpoch: number;
  snapshotUpdatedAtMillis: number;
  snapshotDigest: string;
  commandDigest: string;
}

export interface DurablePlatformExecutionAttemptPointer {
  schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
  generation: Omit<DurablePlatformExecutionPointer, 'schema'>;
  attempt: number;
}

export interface DurablePlatformCheckpointIdentity extends DurablePlatformRecoveryIdentity {
  schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
}

export type DurablePlatformExecutionState =
  | 'scheduling'
  | 'enqueued'
  | 'submitted'
  | 'running'
  | 'retry_waiting'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'expired'
  | 'blocked';

export type DurablePlatformFailureReason =
  | 'transient_unavailable'
  | 'remote_still_pending'
  | 'provider_temporarily_unavailable'
  | 'generation_changed'
  | 'authority_changed'
  | 'handler_rejected'
  | 'handler_failed'
  | 'retry_exhausted'
  | 'platform_expired'
  | 'continued_processing_interrupted'
  | 'platform_request_missing'
  | 'platform_terminated_without_receipt';

export type DurablePlatformUnsupportedReason =
  | 'invalid_request'
  | 'process_bound_interactive_work'
  | 'no_general_agent_foreground_service_contract'
  | 'continued_processing_unavailable'
  | 'foreground_user_action_required'
  | 'stale_request_timestamp'
  | 'continued_processing_delay_unsupported'
  | 'unsupported_network_constraint'
  | 'unsupported_platform_constraint'
  | 'missing_event_trigger_contract'
  | 'missing_required_network_constraint'
  | 'device_idle_backoff_unsupported'
  | 'unsafe_recovery_command';

export type DurablePlatformRejectionReason =
  | 'stale_control_epoch'
  | 'command_identity_conflict'
  | 'request_contract_conflict'
  | 'active_older_generation'
  | 'terminal_generation'
  | 'record_not_found'
  | 'invalid_progress_transition'
  | 'invalid_progress'
  | 'invalid_checkpoint'
  | 'stale_attempt'
  | 'continued_retry_requires_user_action'
  | 'platform_terminated_without_receipt';

export type DurablePlatformDeferReason =
  | 'store_unavailable'
  | 'store_conflict'
  | 'scheduler_unavailable'
  | 'scheduler_conflict';

interface DurablePlatformRecordBase {
  request: DurablePlatformExecutionRequest;
  state: DurablePlatformExecutionState;
  attempt: number;
  nextAttemptAtMillis: number | null;
  failureReason: DurablePlatformFailureReason | null;
  receiptDigest: string | null;
  revision: number;
  updatedAtMillis: number;
}

export interface IOSDurablePlatformRecord extends DurablePlatformRecordBase {
  schedulerKind: 'continued_processing' | 'background_processing';
  taskIdentifier: string;
  progressCompleted: number | null;
  progressTotal: number | null;
  lastCheckpointAtMillis: number | null;
}

export interface AndroidDurablePlatformRecord extends DurablePlatformRecordBase {
  schedulerKind: 'work_manager_one_time';
  uniqueWorkName: string;
  platformWorkId: string;
}

export type DurablePlatformExecutionRecord =
  | IOSDurablePlatformRecord
  | AndroidDurablePlatformRecord;

export type DurablePlatformAdapterResult =
  | {
      schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
      status: 'accepted' | 'no_op' | 'released';
      reason: null;
      record: DurablePlatformExecutionRecord;
    }
  | {
      schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
      status: 'unsupported';
      reason: DurablePlatformUnsupportedReason;
      record: null;
    }
  | {
      schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
      status: 'rejected';
      reason: DurablePlatformRejectionReason;
      record: null;
    }
  | {
      schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
      status: 'deferred';
      reason: DurablePlatformDeferReason;
      record: null;
    };

export type DurablePlatformReadResult =
  | {
      schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
      status: 'found';
      record: DurablePlatformExecutionRecord;
    }
  | {
      schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
      status: 'missing' | 'unavailable';
      record: null;
    };

export type IOSDurableWakeTrigger =
  | 'platform_launch'
  | 'platform_expiration'
  | 'relaunch_reconciliation';

export type IOSDurableWakeDisposition =
  | 'recover'
  | 'interrupt_then_recover'
  | 'require_user_action';

export interface IOSDurableWakeEvent {
  schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
  trigger: IOSDurableWakeTrigger;
  disposition: IOSDurableWakeDisposition;
  record: IOSDurablePlatformRecord;
}

export type IOSDurablePendingLaunches =
  | {
      schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
      status: 'available';
      events: IOSDurableWakeEvent[];
    }
  | {
      schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
      status: 'unavailable';
      events: [];
    };

export type DurablePlatformOutboxSide =
  | {
      status: 'completed';
      outcomes: Array<{ runId: string; result: DurablePlatformAdapterResult }>;
    }
  | { status: 'store_unavailable'; outcomes: [] };

export interface DurablePlatformOutboxResult {
  schema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
  scheduling: DurablePlatformOutboxSide;
  cancellation: DurablePlatformOutboxSide;
}

export interface DurablePlatformExecutionBridge {
  readonly bridgeSchema: typeof DURABLE_PLATFORM_BRIDGE_SCHEMA;
  readonly wakeEventName?: string;
  readonly supportsProgressCheckpoint: boolean;
  enqueue(request: DurablePlatformExecutionRequest): Promise<DurablePlatformAdapterResult>;
  cancel(
    pointer: DurablePlatformExecutionPointer,
    updatedAtMillis: number,
  ): Promise<DurablePlatformAdapterResult>;
  complete(
    pointer: DurablePlatformExecutionAttemptPointer,
    receiptDigest: string,
    updatedAtMillis: number,
  ): Promise<DurablePlatformAdapterResult>;
  scheduleRetry(
    pointer: DurablePlatformExecutionAttemptPointer,
    nextAttemptAtMillis: number,
    failureReason: Extract<
      DurablePlatformFailureReason,
      'transient_unavailable' | 'remote_still_pending' | 'provider_temporarily_unavailable'
    >,
    updatedAtMillis: number,
  ): Promise<DurablePlatformAdapterResult>;
  block(
    pointer: DurablePlatformExecutionAttemptPointer,
    failureReason: Extract<
      DurablePlatformFailureReason,
      'generation_changed' | 'authority_changed' | 'handler_rejected' | 'handler_failed'
    >,
    updatedAtMillis: number,
  ): Promise<DurablePlatformAdapterResult>;
  releaseTerminal(pointer: DurablePlatformExecutionPointer): Promise<DurablePlatformAdapterResult>;
  getRecord(runId: string): Promise<DurablePlatformReadResult>;
  reconcileOutboxes(limit: number): Promise<DurablePlatformOutboxResult>;
  reportProgress?(
    pointer: DurablePlatformExecutionAttemptPointer,
    completed: number,
    total: number,
    updatedAtMillis: number,
  ): Promise<DurablePlatformAdapterResult>;
  checkpoint?(
    pointer: DurablePlatformExecutionAttemptPointer,
    nextIdentity: DurablePlatformCheckpointIdentity,
    updatedAtMillis: number,
  ): Promise<DurablePlatformAdapterResult>;
  getPendingLaunches?(limit: number): Promise<IOSDurablePendingLaunches>;
}
