import {
  requestDurableRecoveryCancellation,
  type DurableRecoveryCancellationDependencies,
} from '../../src/services/executionJournal/durableRecoveryCancellation';
import type {
  AndroidExternalDurableExecutionRequest,
  AndroidDurableExecutionRecord,
  AndroidDurableReadResult,
} from '../../src/services/executionJournal/androidDurableExecutionTypes';
import type {
  DurablePlatformAdapterResult,
  DurablePlatformExecutionBridge,
  IOSDurablePlatformRecord,
} from '../../src/services/executionJournal/durablePlatformBridgeTypes';

const input = {
  runId: 'run-1',
  expectedGeneration: {
    controlEpoch: 2,
    updatedAt: 100,
    snapshotDigest: 'a'.repeat(64),
  },
  occurredAt: 101,
  reason: 'User cancelled the durable run.',
};

function request(): AndroidExternalDurableExecutionRequest {
  return {
    schema: 1 as const,
    durabilityClass: 'external_durable_operation' as const,
    identity: {
      runId: 'run-1',
      controlEpoch: 2,
      snapshotUpdatedAtMillis: 100,
      snapshotDigest: 'a'.repeat(64),
      commandKind: 'reconcile_external_handles' as const,
      commandDigest: 'b'.repeat(64),
    },
    constraints: {
      network: 'connected' as const,
      requiresCharging: false,
      requiresBatteryNotLow: false,
      requiresStorageNotLow: false,
      requiresDeviceIdle: false,
      earliestStartAtMillis: 100,
    },
    retryPolicy: {
      maxAttempts: 5,
      backoffPolicy: 'exponential' as const,
      initialBackoffMillis: 30_000,
    },
    requestedAtMillis: 100,
  };
}

function iosRecord(): IOSDurablePlatformRecord {
  return {
    request: request(),
    schedulerKind: 'background_processing',
    taskIdentifier: 'com.kavi.app.durable-processing',
    state: 'running',
    attempt: 1,
    nextAttemptAtMillis: null,
    failureReason: null,
    receiptDigest: null,
    progressCompleted: null,
    progressTotal: null,
    lastCheckpointAtMillis: null,
    revision: 2,
    updatedAtMillis: 150,
  };
}

function androidRecord(): AndroidDurableExecutionRecord {
  return {
    request: request(),
    schedulerKind: 'work_manager_one_time',
    uniqueWorkName: 'durable-run-1',
    platformWorkId: '12345678-1234-1234-1234-123456789abc',
    state: 'running',
    attempt: 1,
    nextAttemptAtMillis: null,
    failureReason: null,
    receiptDigest: null,
    revision: 2,
    updatedAtMillis: 150,
  };
}

function adapterResult(record: IOSDurablePlatformRecord): DurablePlatformAdapterResult {
  return { schema: 1, status: 'accepted', reason: null, record };
}

function iosBridge(record: IOSDurablePlatformRecord = iosRecord()): DurablePlatformExecutionBridge {
  return {
    bridgeSchema: 1,
    wakeEventName: 'KaviDurableExecutionWake',
    supportsProgressCheckpoint: false,
    enqueue: jest.fn(),
    cancel: jest.fn().mockResolvedValue(adapterResult(record)),
    complete: jest.fn(),
    scheduleRetry: jest.fn(),
    block: jest.fn(),
    releaseTerminal: jest.fn(),
    getRecord: jest.fn().mockResolvedValue({ schema: 1, status: 'found', record }),
    reconcileOutboxes: jest.fn(),
  };
}

function dependencies(
  platform: string,
  overrides: Partial<DurableRecoveryCancellationDependencies> = {},
): DurableRecoveryCancellationDependencies {
  const android = androidRecord();
  return {
    platform,
    requestJournal: jest.fn().mockResolvedValue({
      kind: 'requested',
      receipt: {
        runId: 'run-1',
        controlEpoch: 2,
        cancellationState: 'cancel_requested',
        updatedAt: 101,
      },
    }),
    readAndroid: jest.fn().mockResolvedValue({ schema: 1, status: 'found', record: android }),
    cancelAndroid: jest.fn().mockResolvedValue({
      schema: 1,
      status: 'accepted',
      reason: null,
      record: android,
    }),
    getIOSBridge: jest.fn(() => iosBridge()),
    ...overrides,
  };
}

describe('durable recovery cancellation', () => {
  it('journals and aborts the owner before cancelling the exact iOS generation', async () => {
    const order: string[] = [];
    const bridge = iosBridge();
    jest.mocked(bridge.getRecord).mockImplementation(async () => {
      order.push('read-native');
      return { schema: 1, status: 'found', record: iosRecord() };
    });
    jest.mocked(bridge.cancel).mockImplementation(async () => {
      order.push('cancel-native');
      return adapterResult(iosRecord());
    });
    const deps = dependencies('ios', {
      requestJournal: jest.fn(async () => {
        order.push('journal');
        order.push('abort-owner');
        return {
          kind: 'requested',
          receipt: {
            runId: 'run-1',
            controlEpoch: 2,
            cancellationState: 'cancel_requested',
            updatedAt: 101,
          },
        };
      }),
      getIOSBridge: () => bridge,
    });

    await expect(requestDurableRecoveryCancellation(input, deps)).resolves.toMatchObject({
      kind: 'requested',
      native: { kind: 'cancelled', runId: 'run-1' },
    });
    expect(order).toEqual(['journal', 'abort-owner', 'read-native', 'cancel-native']);
    expect(bridge.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        snapshotUpdatedAtMillis: 100,
        commandDigest: 'b'.repeat(64),
      }),
      151,
    );
  });

  it('cancels the exact Android generation only after journal acceptance', async () => {
    const deps = dependencies('android');

    await expect(requestDurableRecoveryCancellation(input, deps)).resolves.toMatchObject({
      kind: 'requested',
      native: { kind: 'cancelled', runId: 'run-1' },
    });

    expect(deps.requestJournal).toHaveBeenCalledWith(input);
    expect(deps.readAndroid).toHaveBeenCalledWith('run-1');
    expect(deps.cancelAndroid).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', commandDigest: 'b'.repeat(64) }),
      151,
    );
    expect(jest.mocked(deps.requestJournal).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(deps.readAndroid).mock.invocationCallOrder[0],
    );
  });

  it('never touches native state after a stale journal request', async () => {
    const bridge = iosBridge();
    const deps = dependencies('ios', {
      requestJournal: jest.fn().mockResolvedValue({
        kind: 'rejected',
        reason: 'generation_changed',
      }),
      getIOSBridge: () => bridge,
    });

    await expect(requestDurableRecoveryCancellation(input, deps)).resolves.toEqual({
      kind: 'rejected',
      reason: 'generation_changed',
    });
    expect(bridge.getRecord).not.toHaveBeenCalled();
    expect(bridge.cancel).not.toHaveBeenCalled();
  });

  it('never cancels a different native generation after journal acceptance', async () => {
    const newer = iosRecord();
    newer.request.identity.snapshotUpdatedAtMillis = 102;
    const bridge = iosBridge(newer);
    const deps = dependencies('ios', { getIOSBridge: () => bridge });

    await expect(requestDurableRecoveryCancellation(input, deps)).resolves.toMatchObject({
      kind: 'requested',
      native: { kind: 'blocked', reason: 'native_generation_changed' },
    });
    expect(bridge.cancel).not.toHaveBeenCalled();
  });

  it('exactly cancels an older native generation covered by the accepted journal epoch', async () => {
    const older = iosRecord();
    older.request.identity.snapshotUpdatedAtMillis = 99;
    older.request.identity.snapshotDigest = 'c'.repeat(64);
    older.request.requestedAtMillis = 99;
    const bridge = iosBridge(older);
    const deps = dependencies('ios', { getIOSBridge: () => bridge });

    await expect(requestDurableRecoveryCancellation(input, deps)).resolves.toMatchObject({
      kind: 'requested',
      native: { kind: 'cancelled', runId: 'run-1' },
    });
    expect(bridge.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        snapshotUpdatedAtMillis: 99,
        snapshotDigest: 'c'.repeat(64),
      }),
      151,
    );
  });

  it.each([
    [
      'missing',
      { schema: 1, status: 'missing', record: null },
      { kind: 'not_scheduled', runId: 'run-1' },
    ],
    [
      'unavailable',
      { schema: 1, status: 'unavailable', record: null },
      { kind: 'deferred', runId: 'run-1', reason: 'native_store_unavailable' },
    ],
  ] as const)(
    'keeps journal cancellation authoritative when Android native state is %s',
    async (_label, readResult, native) => {
      const deps = dependencies('android', {
        readAndroid: jest.fn().mockResolvedValue(readResult as AndroidDurableReadResult),
      });

      await expect(requestDurableRecoveryCancellation(input, deps)).resolves.toMatchObject({
        kind: 'requested',
        native,
      });
      expect(deps.cancelAndroid).not.toHaveBeenCalled();
    },
  );

  it('journals cancellation on unsupported platforms without invoking native code', async () => {
    const deps = dependencies('web');

    await expect(requestDurableRecoveryCancellation(input, deps)).resolves.toMatchObject({
      kind: 'requested',
      native: {
        kind: 'not_supported',
        runId: 'run-1',
        reason: 'unsupported_platform',
      },
    });
    expect(deps.readAndroid).not.toHaveBeenCalled();
    expect(deps.getIOSBridge).not.toHaveBeenCalled();
  });
});
