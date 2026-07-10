import {
  continuePersistedAndroidExternalRecoveryRun,
  schedulePersistedAndroidExternalRecoveryCandidateSlice,
  schedulePersistedAndroidExternalRecoveryRun,
} from '../../src/services/executionJournal/androidDurableRecoveryScheduling';
import type { PersistedExternalRecoveryCandidate } from '../../src/services/executionJournal/productionRecovery';
import type { AndroidDurableExecutionRecord } from '../../src/services/executionJournal/androidDurableExecutionTypes';

describe('Android durable recovery scheduling', () => {
  it('schedules the exact current generation at its persisted retry time', async () => {
    const dependencies = harness();

    await expect(
      schedulePersistedAndroidExternalRecoveryRun('run-1', dependencies),
    ).resolves.toEqual({ kind: 'scheduled', runId: 'run-1' });

    expect(dependencies.enqueueNative).toHaveBeenCalledWith({
      schema: 1,
      durabilityClass: 'external_durable_operation',
      identity: {
        runId: 'run-1',
        controlEpoch: 2,
        snapshotUpdatedAtMillis: 150,
        snapshotDigest: 'c'.repeat(64),
        commandKind: 'reconcile_external_handles',
        commandDigest: 'd'.repeat(64),
      },
      constraints: {
        network: 'connected',
        requiresCharging: false,
        requiresBatteryNotLow: true,
        requiresStorageNotLow: true,
        requiresDeviceIdle: false,
        earliestStartAtMillis: 60_100,
      },
      retryPolicy: {
        maxAttempts: 5,
        backoffPolicy: 'exponential',
        initialBackoffMillis: 30_000,
      },
      requestedAtMillis: 200,
    });
  });

  it('releases a terminal predecessor before scheduling its fresh successor', async () => {
    const dependencies = harness({
      nativeRead: {
        schema: 1 as const,
        status: 'found' as const,
        record: nativeRecord({ state: 'completed' }),
      },
    });

    await expect(
      schedulePersistedAndroidExternalRecoveryRun('run-1', dependencies),
    ).resolves.toEqual({ kind: 'scheduled', runId: 'run-1' });

    expect(dependencies.releaseNative).toHaveBeenCalledWith({
      schema: 1,
      runId: 'run-1',
      controlEpoch: 2,
      snapshotUpdatedAtMillis: 90,
      snapshotDigest: 'a'.repeat(64),
      commandDigest: 'b'.repeat(64),
    });
    expect(dependencies.releaseNative.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.enqueueNative.mock.invocationCallOrder[0],
    );
  });

  it('never replaces an active generation or loops a terminal current generation', async () => {
    const active = harness({
      nativeRead: {
        schema: 1 as const,
        status: 'found' as const,
        record: nativeRecord({ state: 'running' }),
      },
    });
    await expect(schedulePersistedAndroidExternalRecoveryRun('run-1', active)).resolves.toEqual({
      kind: 'deferred',
      runId: 'run-1',
      reason: 'older_native_generation_active',
    });
    expect(active.releaseNative).not.toHaveBeenCalled();
    expect(active.enqueueNative).not.toHaveBeenCalled();

    const currentTerminal = harness({
      candidate: candidate({ generationUpdatedAt: 90, snapshotDigest: 'a', commandDigest: 'b' }),
      nativeRead: {
        schema: 1 as const,
        status: 'found' as const,
        record: nativeRecord({ state: 'blocked' }),
      },
    });
    await expect(
      schedulePersistedAndroidExternalRecoveryRun('run-1', currentTerminal),
    ).resolves.toEqual({
      kind: 'blocked',
      runId: 'run-1',
      reason: 'candidate_generation_terminal',
    });
  });

  it('schedules one bounded cursor slice and re-reads every run before enqueue', async () => {
    const dependencies = harness();
    dependencies.listCandidates.mockResolvedValueOnce({
      kind: 'candidates',
      candidates: [candidate()],
      nextAfter: '[150,"run-1"]',
    });

    await expect(
      schedulePersistedAndroidExternalRecoveryCandidateSlice({ limit: 1 }, dependencies),
    ).resolves.toEqual({
      outcomes: [{ kind: 'scheduled', runId: 'run-1' }],
      nextAfter: '[150,"run-1"]',
    });
    expect(dependencies.listCandidates).toHaveBeenCalledWith({ limit: 1 });
    expect(dependencies.readCandidate).toHaveBeenCalledWith('run-1');
  });

  it('rejects a stalled candidate cursor instead of looping or truncating', async () => {
    const dependencies = harness();
    dependencies.listCandidates.mockResolvedValue({
      kind: 'candidates',
      candidates: [],
      nextAfter: '[150,"run-1"]',
    });

    await expect(
      schedulePersistedAndroidExternalRecoveryCandidateSlice(
        { limit: 25, after: '[150,"run-1"]' },
        dependencies,
      ),
    ).rejects.toThrow('android-durable-scan-cursor-stalled');
    expect(dependencies.readCandidate).not.toHaveBeenCalled();
  });

  it('releases the exact terminal predecessor when the journal has no successor', async () => {
    const dependencies = harness({
      nativeRead: {
        schema: 1 as const,
        status: 'found' as const,
        record: nativeRecord({ state: 'completed' }),
      },
    });
    dependencies.readCandidate.mockResolvedValue({
      kind: 'not_candidate',
      runId: 'run-1',
    });

    await expect(
      continuePersistedAndroidExternalRecoveryRun(
        'run-1',
        '00000000-0000-4000-8000-000000000061',
        dependencies,
      ),
    ).resolves.toEqual({ kind: 'not_candidate', runId: 'run-1' });
    expect(dependencies.releaseNative).toHaveBeenCalledTimes(1);
    expect(dependencies.enqueueNative).not.toHaveBeenCalled();
  });

  function harness(
    options: {
      candidate?: PersistedExternalRecoveryCandidate;
      nativeRead?:
        | ReturnType<typeof missingNativeRead>
        | {
            schema: 1;
            status: 'found';
            record: AndroidDurableExecutionRecord;
          };
    } = {},
  ) {
    const exactCandidate = options.candidate ?? candidate();
    return {
      now: jest.fn(() => 200),
      readCandidate: jest.fn().mockResolvedValue({
        kind: 'candidate' as const,
        candidate: exactCandidate,
      }),
      listCandidates: jest.fn(),
      readNative: jest.fn().mockResolvedValue(options.nativeRead ?? missingNativeRead()),
      releaseNative: jest.fn().mockResolvedValue({
        schema: 1 as const,
        status: 'released' as const,
        reason: null,
        record: nativeRecord({ state: 'completed' }),
      }),
      enqueueNative: jest.fn().mockResolvedValue({
        schema: 1 as const,
        status: 'accepted' as const,
        reason: null,
        record: nativeRecord({ state: 'enqueued' }),
      }),
    };
  }

  function missingNativeRead() {
    return { schema: 1 as const, status: 'missing' as const, record: null };
  }

  function candidate(
    options: {
      generationUpdatedAt?: number;
      snapshotDigest?: string;
      commandDigest?: string;
    } = {},
  ): PersistedExternalRecoveryCandidate {
    const snapshotDigest = (options.snapshotDigest ?? 'c').repeat(64);
    const commandDigest = (options.commandDigest ?? 'd').repeat(64);
    return {
      runId: 'run-1',
      generation: {
        controlEpoch: 2,
        updatedAt: options.generationUpdatedAt ?? 150,
        snapshotDigest,
      },
      command: {
        kind: 'reconcile_external_handles',
        runId: 'run-1',
        controlEpoch: 2,
        effectIds: ['effect-1'],
        handleIds: ['handle-1'],
      },
      commandDigest,
      retryAt: 60_100,
    };
  }

  function nativeRecord(options: {
    state: AndroidDurableExecutionRecord['state'];
  }): AndroidDurableExecutionRecord {
    return {
      request: {
        schema: 1,
        durabilityClass: 'external_durable_operation',
        identity: {
          runId: 'run-1',
          controlEpoch: 2,
          snapshotUpdatedAtMillis: 90,
          snapshotDigest: 'a'.repeat(64),
          commandKind: 'reconcile_external_handles',
          commandDigest: 'b'.repeat(64),
        },
        constraints: {
          network: 'connected',
          requiresCharging: false,
          requiresBatteryNotLow: true,
          requiresStorageNotLow: true,
          requiresDeviceIdle: false,
          earliestStartAtMillis: 100,
        },
        retryPolicy: {
          maxAttempts: 5,
          backoffPolicy: 'exponential',
          initialBackoffMillis: 30_000,
        },
        requestedAtMillis: 100,
      },
      schedulerKind: 'work_manager_one_time',
      uniqueWorkName: `kavi.durable-recovery.v1.run-1.${'b'.repeat(64)}`,
      platformWorkId: '00000000-0000-4000-8000-000000000061',
      state: options.state,
      attempt: 1,
      nextAttemptAtMillis: null,
      failureReason: options.state === 'blocked' ? 'handler_failed' : null,
      receiptDigest: options.state === 'completed' ? 'e'.repeat(64) : null,
      revision: 3,
      updatedAtMillis: 100,
    };
  }
});
