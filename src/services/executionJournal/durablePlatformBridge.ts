import {
  DURABLE_PLATFORM_BRIDGE_SCHEMA,
  type DurablePlatformAdapterResult,
  type DurablePlatformCheckpointIdentity,
  type DurablePlatformExecutionAttemptPointer,
  type DurablePlatformExecutionBridge,
  type DurablePlatformExecutionPointer,
  type DurablePlatformExecutionRequest,
  type DurablePlatformFailureReason,
  type DurablePlatformOutboxResult,
  type DurablePlatformReadResult,
  type IOSDurablePendingLaunches,
  type IOSDurableWakeEvent,
} from './durablePlatformBridgeTypes';
import {
  parseDurablePlatformAdapterResult,
  parseDurablePlatformOutboxResult,
  parseDurablePlatformReadResult,
  parseIOSDurablePendingLaunches,
  parseIOSDurableWakeEvent,
} from './durablePlatformBridgeValidation';

interface NativeDurableExecutionModule {
  bridgeSchema?: number;
  wakeEventName?: string;
  supportsProgressCheckpoint?: boolean;
  enqueue(request: DurablePlatformExecutionRequest): Promise<unknown>;
  cancel(pointer: DurablePlatformExecutionPointer, updatedAtMillis: number): Promise<unknown>;
  complete(
    pointer: DurablePlatformExecutionAttemptPointer,
    receiptDigest: string,
    updatedAtMillis: number,
  ): Promise<unknown>;
  scheduleRetry(
    pointer: DurablePlatformExecutionAttemptPointer,
    nextAttemptAtMillis: number,
    failureReason: string,
    updatedAtMillis: number,
  ): Promise<unknown>;
  block(
    pointer: DurablePlatformExecutionAttemptPointer,
    failureReason: string,
    updatedAtMillis: number,
  ): Promise<unknown>;
  releaseTerminal(pointer: DurablePlatformExecutionPointer): Promise<unknown>;
  getRecord(runId: string): Promise<unknown>;
  reconcileOutboxes(limit: number): Promise<unknown>;
  reportProgress?(
    pointer: DurablePlatformExecutionAttemptPointer,
    completed: number,
    total: number,
    updatedAtMillis: number,
  ): Promise<unknown>;
  checkpoint?(
    pointer: DurablePlatformExecutionAttemptPointer,
    nextIdentity: DurablePlatformCheckpointIdentity,
    updatedAtMillis: number,
  ): Promise<unknown>;
  getPendingLaunches?(limit: number): Promise<unknown>;
}

function getNativeModule(): NativeDurableExecutionModule | null {
  const { NativeModules } = require('react-native') as typeof import('react-native');
  const candidate = NativeModules.KaviDurableExecution as NativeDurableExecutionModule | undefined;
  if (
    !candidate ||
    candidate.bridgeSchema !== DURABLE_PLATFORM_BRIDGE_SCHEMA ||
    ![
      'enqueue',
      'cancel',
      'complete',
      'scheduleRetry',
      'block',
      'releaseTerminal',
      'getRecord',
      'reconcileOutboxes',
    ].every((name) => typeof candidate[name as keyof NativeDurableExecutionModule] === 'function')
  ) {
    return null;
  }
  return candidate;
}

export function getDurablePlatformExecutionBridge(): DurablePlatformExecutionBridge | null {
  const native = getNativeModule();
  if (!native) return null;
  const bridge: DurablePlatformExecutionBridge = {
    bridgeSchema: DURABLE_PLATFORM_BRIDGE_SCHEMA,
    ...(typeof native.wakeEventName === 'string' ? { wakeEventName: native.wakeEventName } : {}),
    supportsProgressCheckpoint:
      native.supportsProgressCheckpoint === true &&
      typeof native.reportProgress === 'function' &&
      typeof native.checkpoint === 'function',
    enqueue: async (request): Promise<DurablePlatformAdapterResult> =>
      parseDurablePlatformAdapterResult(await native.enqueue(request)),
    cancel: async (pointer, updatedAtMillis): Promise<DurablePlatformAdapterResult> =>
      parseDurablePlatformAdapterResult(await native.cancel(pointer, updatedAtMillis)),
    complete: async (
      pointer,
      receiptDigest,
      updatedAtMillis,
    ): Promise<DurablePlatformAdapterResult> =>
      parseDurablePlatformAdapterResult(
        await native.complete(pointer, receiptDigest, updatedAtMillis),
      ),
    scheduleRetry: async (
      pointer,
      nextAttemptAtMillis,
      failureReason,
      updatedAtMillis,
    ): Promise<DurablePlatformAdapterResult> =>
      parseDurablePlatformAdapterResult(
        await native.scheduleRetry(pointer, nextAttemptAtMillis, failureReason, updatedAtMillis),
      ),
    block: async (pointer, failureReason, updatedAtMillis): Promise<DurablePlatformAdapterResult> =>
      parseDurablePlatformAdapterResult(
        await native.block(pointer, failureReason, updatedAtMillis),
      ),
    releaseTerminal: async (pointer): Promise<DurablePlatformAdapterResult> =>
      parseDurablePlatformAdapterResult(await native.releaseTerminal(pointer)),
    getRecord: async (runId): Promise<DurablePlatformReadResult> =>
      parseDurablePlatformReadResult(await native.getRecord(runId)),
    reconcileOutboxes: async (limit): Promise<DurablePlatformOutboxResult> =>
      parseDurablePlatformOutboxResult(await native.reconcileOutboxes(limit)),
  };
  if (typeof native.reportProgress === 'function') {
    bridge.reportProgress = async (
      pointer,
      completed,
      total,
      updatedAtMillis,
    ): Promise<DurablePlatformAdapterResult> =>
      parseDurablePlatformAdapterResult(
        await native.reportProgress!(pointer, completed, total, updatedAtMillis),
      );
  }
  if (typeof native.checkpoint === 'function') {
    bridge.checkpoint = async (
      pointer,
      nextIdentity,
      updatedAtMillis,
    ): Promise<DurablePlatformAdapterResult> =>
      parseDurablePlatformAdapterResult(
        await native.checkpoint!(pointer, nextIdentity, updatedAtMillis),
      );
  }
  if (typeof native.getPendingLaunches === 'function') {
    bridge.getPendingLaunches = async (limit): Promise<IOSDurablePendingLaunches> =>
      parseIOSDurablePendingLaunches(await native.getPendingLaunches!(limit));
  }
  return bridge;
}

export function subscribeToIOSDurableWakeEvents(
  onEvent: (event: IOSDurableWakeEvent) => void,
  onInvalidEvent: (error: Error) => void,
): { remove(): void } | null {
  const native = getNativeModule();
  if (!native?.wakeEventName || typeof native.getPendingLaunches !== 'function') {
    return null;
  }
  const reactNative = require('react-native') as typeof import('react-native');
  const emitter = new reactNative.NativeEventEmitter(native as never);
  return emitter.addListener(native.wakeEventName, (value: unknown) => {
    try {
      onEvent(parseIOSDurableWakeEvent(value));
    } catch (error) {
      onInvalidEvent(
        error instanceof Error ? error : new Error('durable-platform-bridge-invalid-wake'),
      );
    }
  });
}

export type {
  DurablePlatformCheckpointIdentity,
  DurablePlatformExecutionAttemptPointer,
  DurablePlatformExecutionPointer,
  DurablePlatformExecutionRequest,
  DurablePlatformFailureReason,
  IOSDurableWakeEvent,
};
