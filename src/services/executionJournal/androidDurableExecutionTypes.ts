export const ANDROID_DURABLE_BRIDGE_SCHEMA = 1 as const;
export const ANDROID_DURABLE_HEADLESS_TASK_KEY = 'KaviDurableRecovery' as const;

export type AndroidDurableExecutionState =
  | 'scheduling'
  | 'enqueued'
  | 'running'
  | 'retry_waiting'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'blocked';

export type AndroidDurableFailureReason =
  | 'transient_unavailable'
  | 'remote_still_pending'
  | 'provider_temporarily_unavailable'
  | 'generation_changed'
  | 'authority_changed'
  | 'handler_rejected'
  | 'handler_failed'
  | 'retry_exhausted'
  | 'platform_terminated_without_receipt';

export interface AndroidExternalDurableExecutionRequest {
  schema: typeof ANDROID_DURABLE_BRIDGE_SCHEMA;
  durabilityClass: 'external_durable_operation';
  identity: {
    runId: string;
    controlEpoch: number;
    snapshotUpdatedAtMillis: number;
    snapshotDigest: string;
    commandKind: 'reconcile_external_handles';
    commandDigest: string;
  };
  constraints: {
    network: 'connected' | 'unmetered';
    requiresCharging: boolean;
    requiresBatteryNotLow: boolean;
    requiresStorageNotLow: boolean;
    requiresDeviceIdle: false;
    earliestStartAtMillis: number;
  };
  retryPolicy: {
    maxAttempts: number;
    backoffPolicy: 'exponential';
    initialBackoffMillis: number;
  };
  requestedAtMillis: number;
}

export interface AndroidDurableExecutionPointer {
  schema: typeof ANDROID_DURABLE_BRIDGE_SCHEMA;
  runId: string;
  controlEpoch: number;
  snapshotUpdatedAtMillis: number;
  snapshotDigest: string;
  commandDigest: string;
}

export interface AndroidDurableExecutionAttemptPointer {
  schema: typeof ANDROID_DURABLE_BRIDGE_SCHEMA;
  generation: Omit<AndroidDurableExecutionPointer, 'schema'>;
  attempt: number;
}

export interface AndroidDurableExecutionRecord {
  request: AndroidExternalDurableExecutionRequest;
  schedulerKind: 'work_manager_one_time';
  uniqueWorkName: string;
  platformWorkId: string;
  state: AndroidDurableExecutionState;
  attempt: number;
  nextAttemptAtMillis: number | null;
  failureReason: AndroidDurableFailureReason | null;
  receiptDigest: string | null;
  revision: number;
  updatedAtMillis: number;
}

export type AndroidDurableAdapterResult =
  | {
      schema: typeof ANDROID_DURABLE_BRIDGE_SCHEMA;
      status: 'accepted' | 'no_op' | 'released';
      reason: null;
      record: AndroidDurableExecutionRecord;
    }
  | {
      schema: typeof ANDROID_DURABLE_BRIDGE_SCHEMA;
      status: 'unsupported' | 'rejected' | 'deferred';
      reason: string;
      record: null;
    };

export type AndroidDurableReadResult =
  | {
      schema: typeof ANDROID_DURABLE_BRIDGE_SCHEMA;
      status: 'found';
      record: AndroidDurableExecutionRecord;
    }
  | {
      schema: typeof ANDROID_DURABLE_BRIDGE_SCHEMA;
      status: 'missing' | 'unavailable';
      record: null;
    };

export interface AndroidDurableHeadlessPayload {
  schema: typeof ANDROID_DURABLE_BRIDGE_SCHEMA;
  workId: string;
  runId: string;
  controlEpoch: number;
  snapshotUpdatedAtMillis: number;
  snapshotDigest: string;
  commandKind: 'reconcile_external_handles';
  commandDigest: string;
  attempt: number;
}
