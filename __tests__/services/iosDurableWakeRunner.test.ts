import type {
  DurablePlatformAdapterResult,
  DurablePlatformExecutionBridge,
  IOSDurablePlatformRecord,
  IOSDurableWakeEvent,
} from '../../src/services/executionJournal/durablePlatformBridgeTypes';
import { runIOSDurableWakeEvent } from '../../src/services/executionJournal/iosDurableWakeRunner';
import type { ExecutionRecoveryCoordinatorOutcome } from '../../src/services/executionJournal/recoveryCoordinatorTypes';

function record(
  state: IOSDurablePlatformRecord['state'] = 'running',
  schedulerKind: IOSDurablePlatformRecord['schedulerKind'] = 'background_processing',
): IOSDurablePlatformRecord {
  const continued = schedulerKind === 'continued_processing';
  return {
    request: {
      schema: 1,
      durabilityClass: continued ? 'user_initiated_continuable' : 'external_durable_operation',
      identity: {
        runId: 'run-1',
        controlEpoch: 2,
        snapshotUpdatedAtMillis: 2_000,
        snapshotDigest: 'a'.repeat(64),
        commandKind: 'reconcile_external_handles',
        commandDigest: 'b'.repeat(64),
      },
      constraints: {
        network: continued ? 'not_required' : 'connected',
        requiresCharging: false,
        requiresBatteryNotLow: false,
        requiresStorageNotLow: false,
        requiresDeviceIdle: false,
        earliestStartAtMillis: 2_000,
      },
      retryPolicy: {
        maxAttempts: 5,
        backoffPolicy: 'exponential',
        initialBackoffMillis: 30_000,
      },
      requestedAtMillis: 2_000,
    },
    schedulerKind,
    taskIdentifier: continued
      ? 'com.kavi.app.durable-continuation.abc'
      : 'com.kavi.app.durable-processing',
    state,
    attempt: 1,
    nextAttemptAtMillis: null,
    failureReason:
      state === 'expired'
        ? continued
          ? 'continued_processing_interrupted'
          : 'platform_expired'
        : state === 'blocked'
          ? 'handler_failed'
          : null,
    receiptDigest: state === 'completed' ? 'c'.repeat(64) : null,
    progressCompleted: null,
    progressTotal: null,
    lastCheckpointAtMillis: null,
    revision: state === 'running' ? 2 : 3,
    updatedAtMillis: state === 'running' ? 2_500 : 3_000,
  };
}

function accepted(nativeRecord: IOSDurablePlatformRecord): DurablePlatformAdapterResult {
  return { schema: 1, status: 'accepted', reason: null, record: nativeRecord };
}

function bridge(
  source: IOSDurablePlatformRecord,
  overrides: Partial<DurablePlatformExecutionBridge> = {},
) {
  return {
    bridgeSchema: 1 as const,
    supportsProgressCheckpoint: false,
    enqueue: jest.fn(),
    cancel: jest.fn().mockResolvedValue(accepted(record('cancelled', source.schedulerKind))),
    complete: jest.fn().mockResolvedValue(accepted(record('completed', source.schedulerKind))),
    scheduleRetry: jest.fn().mockResolvedValue(
      accepted({
        ...source,
        state: 'retry_waiting',
        nextAttemptAtMillis: 32_501,
        failureReason: 'transient_unavailable',
        revision: source.revision + 1,
        updatedAtMillis: 2_501,
      }),
    ),
    block: jest.fn().mockResolvedValue(accepted(record('blocked', source.schedulerKind))),
    releaseTerminal: jest.fn().mockResolvedValue({
      schema: 1,
      status: 'released',
      reason: null,
      record: source,
    }),
    getRecord: jest.fn().mockResolvedValue({ schema: 1, status: 'found', record: source }),
    reconcileOutboxes: jest.fn(),
    ...overrides,
  } as DurablePlatformExecutionBridge;
}

function coordinatorOutcome(
  value: Partial<ExecutionRecoveryCoordinatorOutcome> &
    Pick<ExecutionRecoveryCoordinatorOutcome, 'kind'>,
): ExecutionRecoveryCoordinatorOutcome {
  return {
    runId: 'run-1',
    commandKind: 'reconcile_external_handles',
    controlEpoch: 2,
    snapshotDigest: 'a'.repeat(64),
    commandDigest: 'b'.repeat(64),
    dispatchId: 'dispatch-1',
    dispatchDigest: 'c'.repeat(64),
    fenceId: 'fence-1',
    fenceDigest: 'd'.repeat(64),
    ...value,
  } as ExecutionRecoveryCoordinatorOutcome;
}

function dependencies(
  nativeBridge: DurablePlatformExecutionBridge,
  overrides: Record<string, unknown> = {},
) {
  return {
    now: () => 2_500,
    getBridge: () => nativeBridge,
    coordinate: jest.fn().mockResolvedValue(
      coordinatorOutcome({
        kind: 'completed',
        receiptId: 'receipt-1',
        receiptDigest: 'e'.repeat(64),
      }),
    ),
    continueRun: jest.fn().mockResolvedValue({ kind: 'not_candidate', runId: 'run-1' }),
    requestAttention: jest.fn().mockResolvedValue({
      kind: 'recorded',
      receipt: {
        runId: 'run-1',
        controlEpoch: 2,
        sourceGenerationUpdatedAt: 2_000,
        reason: 'recovery_blocked',
        recordedAt: 2_501,
      },
    }),
    abortOwner: jest.fn().mockReturnValue(true),
    ...overrides,
  };
}

function event(
  source: IOSDurablePlatformRecord,
  trigger: IOSDurableWakeEvent['trigger'] = 'platform_launch',
  disposition: IOSDurableWakeEvent['disposition'] = 'recover',
): IOSDurableWakeEvent {
  return { schema: 1, trigger, disposition, record: source };
}

describe('iOS durable wake runner', () => {
  it('settles one exact fenced receipt and continues only after native completion', async () => {
    const source = record();
    const nativeBridge = bridge(source);
    const deps = dependencies(nativeBridge);

    await expect(runIOSDurableWakeEvent(event(source), deps)).resolves.toEqual({
      kind: 'settled',
      runId: 'run-1',
      settlement: 'completed',
      continuation: { kind: 'not_candidate', runId: 'run-1' },
    });
    expect(deps.coordinate).toHaveBeenCalledWith({
      runId: 'run-1',
      expectedGeneration: {
        controlEpoch: 2,
        updatedAt: 2_000,
        snapshotDigest: 'a'.repeat(64),
      },
    });
    expect(jest.mocked(nativeBridge.complete)).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
      'e'.repeat(64),
      2_501,
    );
    expect(jest.mocked(nativeBridge.complete).mock.invocationCallOrder[0]).toBeLessThan(
      deps.continueRun.mock.invocationCallOrder[0],
    );
  });

  it('never runs recovery on an expired background lease', async () => {
    const source = record('expired');
    const nativeBridge = bridge(source);
    const deps = dependencies(nativeBridge, {
      continueRun: jest.fn().mockResolvedValue({ kind: 'scheduled', runId: 'run-1' }),
    });

    await expect(
      runIOSDurableWakeEvent(event(source, 'platform_expiration', 'interrupt_then_recover'), deps),
    ).resolves.toEqual({
      kind: 'lease_replaced',
      runId: 'run-1',
      continuation: { kind: 'scheduled', runId: 'run-1' },
    });
    expect(deps.coordinate).not.toHaveBeenCalled();
    expect(nativeBridge.complete).not.toHaveBeenCalled();
  });

  it('journals continued-processing attention before releasing expiration evidence', async () => {
    const source = record('expired', 'continued_processing');
    const nativeBridge = bridge(source, {
      releaseTerminal: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'released',
        reason: null,
        record: source,
      }),
    });
    const deps = dependencies(nativeBridge);

    await expect(
      runIOSDurableWakeEvent(event(source, 'platform_expiration', 'require_user_action'), deps),
    ).resolves.toEqual({ kind: 'attention_required', runId: 'run-1' });
    expect(deps.coordinate).not.toHaveBeenCalled();
    expect(deps.requestAttention).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'continued_processing_expired' }),
    );
    expect(deps.requestAttention.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(nativeBridge.releaseTerminal).mock.invocationCallOrder[0],
    );
  });

  it('rejects a stale native generation before journal coordination', async () => {
    const source = record();
    const current = { ...source, revision: source.revision + 1 };
    const nativeBridge = bridge(source, {
      getRecord: jest.fn().mockResolvedValue({ schema: 1, status: 'found', record: current }),
    });
    const deps = dependencies(nativeBridge);

    await expect(runIOSDurableWakeEvent(event(source), deps)).resolves.toEqual({
      kind: 'stale',
      runId: 'run-1',
      reason: 'native_generation_changed',
    });
    expect(deps.coordinate).not.toHaveBeenCalled();
  });

  it('journals authority attention before blocking the native attempt', async () => {
    const source = record();
    const nativeBridge = bridge(source);
    const deps = dependencies(nativeBridge, {
      coordinate: jest.fn().mockResolvedValue(
        coordinatorOutcome({
          kind: 'blocked',
          reason: 'authority_revoked',
          sourceReason: null,
        }),
      ),
    });

    await expect(runIOSDurableWakeEvent(event(source), deps)).resolves.toEqual(
      expect.objectContaining({ kind: 'settled', settlement: 'blocked' }),
    );
    expect(deps.requestAttention).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'recovery_blocked' }),
    );
    expect(deps.requestAttention.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(nativeBridge.block).mock.invocationCallOrder[0],
    );
  });

  it('aborts the JS owner before cancelling a journal-cancelled native attempt', async () => {
    const source = record();
    const nativeBridge = bridge(source);
    const deps = dependencies(nativeBridge, {
      coordinate: jest
        .fn()
        .mockResolvedValue(
          coordinatorOutcome({ kind: 'blocked', reason: 'cancelled', sourceReason: null }),
        ),
    });

    await expect(runIOSDurableWakeEvent(event(source), deps)).resolves.toEqual(
      expect.objectContaining({ kind: 'settled', settlement: 'cancelled' }),
    );
    expect(deps.abortOwner).toHaveBeenCalledWith('run-1', 'Durable recovery was cancelled.');
    expect(deps.abortOwner.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(nativeBridge.cancel).mock.invocationCallOrder[0],
    );
  });

  it('turns a duplicate fence replay into a bounded background retry', async () => {
    const source = record();
    const nativeBridge = bridge(source);
    const deps = dependencies(nativeBridge, {
      coordinate: jest
        .fn()
        .mockResolvedValue(coordinatorOutcome({ kind: 'deferred', reason: 'duplicate_dispatch' })),
    });

    await expect(runIOSDurableWakeEvent(event(source), deps)).resolves.toEqual({
      kind: 'retry_scheduled',
      runId: 'run-1',
      retryAt: 32_501,
    });
    expect(nativeBridge.scheduleRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
      32_501,
      'transient_unavailable',
      2_501,
    );
  });

  it('does not release or continue after a native settlement failure', async () => {
    const source = record();
    const nativeBridge = bridge(source, {
      complete: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'deferred',
        reason: 'store_conflict',
        record: null,
      }),
    });
    const deps = dependencies(nativeBridge);

    await expect(runIOSDurableWakeEvent(event(source), deps)).resolves.toEqual({
      kind: 'deferred',
      runId: 'run-1',
      reason: 'store_conflict',
    });
    expect(deps.continueRun).not.toHaveBeenCalled();
    expect(nativeBridge.releaseTerminal).not.toHaveBeenCalled();
  });
});
