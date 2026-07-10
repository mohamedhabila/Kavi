import {
  continuePersistedIOSExternalRecoveryRun,
  schedulePersistedIOSExternalRecoveryCandidateSlice,
  schedulePersistedIOSExternalRecoveryRun,
} from '../../src/services/executionJournal/iosDurableRecoveryScheduling';
import type {
  DurablePlatformAdapterResult,
  DurablePlatformExecutionBridge,
  DurablePlatformExecutionPointer,
  IOSDurablePlatformRecord,
} from '../../src/services/executionJournal/durablePlatformBridgeTypes';
import type { PersistedExternalRecoveryCandidate } from '../../src/services/executionJournal/productionRecovery';

function candidate(overrides: Partial<PersistedExternalRecoveryCandidate> = {}) {
  const generation = {
    controlEpoch: 2,
    updatedAt: 2_000,
    snapshotDigest: 'a'.repeat(64),
  };
  return {
    runId: 'run-1',
    generation,
    command: {
      kind: 'reconcile_external_handles' as const,
      runId: 'run-1',
      controlEpoch: 2,
      effectIds: ['effect-1'],
      handleIds: ['handle-1'],
    },
    commandDigest: 'b'.repeat(64),
    retryAt: null,
    ...overrides,
  };
}

function record(
  state: IOSDurablePlatformRecord['state'] = 'running',
  overrides: Partial<IOSDurablePlatformRecord['request']['identity']> = {},
): IOSDurablePlatformRecord {
  const identity = {
    runId: 'run-1',
    controlEpoch: 2,
    snapshotUpdatedAtMillis: 2_000,
    snapshotDigest: 'a'.repeat(64),
    commandKind: 'reconcile_external_handles' as const,
    commandDigest: 'b'.repeat(64),
    ...overrides,
  };
  const terminal = ['cancelled', 'completed', 'expired', 'blocked'].includes(state);
  return {
    request: {
      schema: 1,
      durabilityClass: 'external_durable_operation',
      identity,
      constraints: {
        network: 'connected',
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
    schedulerKind: 'background_processing',
    taskIdentifier: 'com.kavi.app.durable-processing',
    state,
    attempt: terminal || state === 'running' ? 1 : 0,
    nextAttemptAtMillis: null,
    failureReason:
      state === 'blocked' ? 'handler_failed' : state === 'expired' ? 'platform_expired' : null,
    receiptDigest: state === 'completed' ? 'c'.repeat(64) : null,
    progressCompleted: null,
    progressTotal: null,
    lastCheckpointAtMillis: null,
    revision: 2,
    updatedAtMillis: 3_000,
  };
}

function adapterResult(
  status: 'accepted' | 'no_op' | 'released',
  nativeRecord = record('running'),
): DurablePlatformAdapterResult {
  return { schema: 1, status, reason: null, record: nativeRecord };
}

function bridge(overrides: Partial<DurablePlatformExecutionBridge> = {}) {
  return {
    bridgeSchema: 1 as const,
    supportsProgressCheckpoint: false,
    enqueue: jest.fn().mockResolvedValue(adapterResult('accepted')),
    cancel: jest.fn().mockResolvedValue(adapterResult('accepted')),
    complete: jest.fn().mockResolvedValue(adapterResult('accepted')),
    scheduleRetry: jest.fn().mockResolvedValue(adapterResult('accepted')),
    block: jest.fn().mockResolvedValue(adapterResult('accepted')),
    releaseTerminal: jest.fn().mockResolvedValue(adapterResult('released', record('completed'))),
    getRecord: jest.fn().mockResolvedValue({ schema: 1, status: 'missing', record: null }),
    reconcileOutboxes: jest.fn().mockResolvedValue({
      schema: 1,
      scheduling: { status: 'completed', outcomes: [] },
      cancellation: { status: 'completed', outcomes: [] },
    }),
    ...overrides,
  } as DurablePlatformExecutionBridge;
}

function dependencies(
  nativeBridge: DurablePlatformExecutionBridge,
  overrides: Record<string, unknown> = {},
) {
  return {
    now: () => 2_500,
    readCandidate: jest.fn().mockResolvedValue({ kind: 'candidate', candidate: candidate() }),
    listCandidates: jest.fn().mockResolvedValue({
      kind: 'candidates',
      candidates: [candidate()],
      nextAfter: null,
    }),
    getBridge: () => nativeBridge,
    ...overrides,
  };
}

function pointer(nativeRecord: IOSDurablePlatformRecord): DurablePlatformExecutionPointer {
  const identity = nativeRecord.request.identity;
  return {
    schema: 1,
    runId: identity.runId,
    controlEpoch: identity.controlEpoch,
    snapshotUpdatedAtMillis: identity.snapshotUpdatedAtMillis,
    snapshotDigest: identity.snapshotDigest,
    commandDigest: identity.commandDigest,
  };
}

describe('iOS durable recovery scheduling', () => {
  it('enqueues an exact missing generation with the persisted retry wake', async () => {
    const nativeBridge = bridge();
    const pending = candidate({ retryAt: 40_000 });
    const deps = dependencies(nativeBridge, {
      readCandidate: jest.fn().mockResolvedValue({ kind: 'candidate', candidate: pending }),
    });

    await expect(schedulePersistedIOSExternalRecoveryRun('run-1', deps)).resolves.toEqual({
      kind: 'scheduled',
      runId: 'run-1',
    });
    expect(nativeBridge.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        durabilityClass: 'external_durable_operation',
        identity: expect.objectContaining({
          runId: 'run-1',
          controlEpoch: 2,
          snapshotUpdatedAtMillis: 2_000,
          commandKind: 'reconcile_external_handles',
          commandDigest: 'b'.repeat(64),
        }),
        constraints: expect.objectContaining({
          network: 'connected',
          earliestStartAtMillis: 40_000,
        }),
      }),
    );
  });

  it('recognizes one active exact generation without resubmitting it', async () => {
    const nativeBridge = bridge({
      getRecord: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'found',
        record: record('running'),
      }),
    });
    await expect(
      schedulePersistedIOSExternalRecoveryRun('run-1', dependencies(nativeBridge)),
    ).resolves.toEqual({ kind: 'already_scheduled', runId: 'run-1' });
    expect(nativeBridge.enqueue).not.toHaveBeenCalled();
    expect(nativeBridge.releaseTerminal).not.toHaveBeenCalled();
  });

  it('blocks a stale candidate and defers behind an active older generation', async () => {
    const newerNative = bridge({
      getRecord: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'found',
        record: record('running', { controlEpoch: 3 }),
      }),
    });
    await expect(
      schedulePersistedIOSExternalRecoveryRun('run-1', dependencies(newerNative)),
    ).resolves.toEqual({
      kind: 'blocked',
      runId: 'run-1',
      reason: 'candidate_generation_stale',
    });

    const olderNative = bridge({
      getRecord: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'found',
        record: record('running', { controlEpoch: 1, snapshotUpdatedAtMillis: 1_000 }),
      }),
    });
    await expect(
      schedulePersistedIOSExternalRecoveryRun('run-1', dependencies(olderNative)),
    ).resolves.toEqual({
      kind: 'deferred',
      runId: 'run-1',
      reason: 'older_native_generation_active',
    });
  });

  it('releases a terminal older generation before scheduling its successor', async () => {
    const predecessor = record('completed', {
      controlEpoch: 1,
      snapshotUpdatedAtMillis: 1_000,
      snapshotDigest: 'd'.repeat(64),
      commandDigest: 'e'.repeat(64),
    });
    const nativeBridge = bridge({
      getRecord: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'found',
        record: predecessor,
      }),
      releaseTerminal: jest.fn().mockResolvedValue(adapterResult('released', predecessor)),
    });

    await expect(
      schedulePersistedIOSExternalRecoveryRun('run-1', dependencies(nativeBridge)),
    ).resolves.toEqual({ kind: 'scheduled', runId: 'run-1' });
    expect(nativeBridge.releaseTerminal).toHaveBeenCalledWith(pointer(predecessor));
    expect(nativeBridge.releaseTerminal.mock.invocationCallOrder[0]).toBeLessThan(
      nativeBridge.enqueue.mock.invocationCallOrder[0],
    );
  });

  it('retains an exact terminal generation instead of deleting current evidence', async () => {
    const nativeBridge = bridge({
      getRecord: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'found',
        record: record('blocked'),
      }),
    });
    await expect(
      schedulePersistedIOSExternalRecoveryRun('run-1', dependencies(nativeBridge)),
    ).resolves.toEqual({
      kind: 'blocked',
      runId: 'run-1',
      reason: 'candidate_generation_terminal',
    });
    expect(nativeBridge.releaseTerminal).not.toHaveBeenCalled();
  });

  it('releases an exact terminal predecessor when the journal has no successor', async () => {
    const terminal = record('completed');
    const nativeBridge = bridge({
      getRecord: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'found',
        record: terminal,
      }),
      releaseTerminal: jest.fn().mockResolvedValue(adapterResult('released', terminal)),
    });
    const deps = dependencies(nativeBridge, {
      readCandidate: jest.fn().mockResolvedValue({ kind: 'not_candidate', runId: 'run-1' }),
    });

    await expect(
      continuePersistedIOSExternalRecoveryRun('run-1', pointer(terminal), deps),
    ).resolves.toEqual({ kind: 'not_candidate', runId: 'run-1' });
    expect(nativeBridge.releaseTerminal).toHaveBeenCalledWith(pointer(terminal));
  });

  it('closes release races and preserves store-capacity failures', async () => {
    const terminal = record('completed');
    const racedBridge = bridge({
      getRecord: jest
        .fn()
        .mockResolvedValueOnce({ schema: 1, status: 'found', record: terminal })
        .mockResolvedValueOnce({ schema: 1, status: 'missing', record: null }),
      releaseTerminal: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'rejected',
        reason: 'record_not_found',
        record: null,
      }),
    });
    const noCandidate = {
      readCandidate: jest.fn().mockResolvedValue({ kind: 'not_candidate', runId: 'run-1' }),
    };
    await expect(
      continuePersistedIOSExternalRecoveryRun(
        'run-1',
        pointer(terminal),
        dependencies(racedBridge, noCandidate),
      ),
    ).resolves.toEqual({ kind: 'not_candidate', runId: 'run-1' });

    const capacityBridge = bridge({
      enqueue: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'deferred',
        reason: 'store_unavailable',
        record: null,
      }),
    });
    await expect(
      schedulePersistedIOSExternalRecoveryRun('run-1', dependencies(capacityBridge)),
    ).resolves.toEqual({
      kind: 'deferred',
      runId: 'run-1',
      reason: 'store_unavailable',
    });
  });

  it('continues bounded candidate scans with the exact cursor', async () => {
    const nativeBridge = bridge();
    const deps = dependencies(nativeBridge, {
      listCandidates: jest.fn().mockResolvedValue({
        kind: 'candidates',
        candidates: [candidate()],
        nextAfter: '[2000,"run-1"]',
      }),
    });
    await expect(
      schedulePersistedIOSExternalRecoveryCandidateSlice({ limit: 1 }, deps),
    ).resolves.toEqual({
      outcomes: [{ kind: 'scheduled', runId: 'run-1' }],
      nextAfter: '[2000,"run-1"]',
    });
    expect(deps.listCandidates).toHaveBeenCalledWith({ limit: 1 });
  });
});
