import {
  decodeAndroidDurableHeadlessPayload,
  registerAndroidDurableRecoveryHeadlessTask,
  runAndroidDurableRecoveryHeadlessTask,
} from '../../src/services/executionJournal/androidRecoveryHeadlessTask';

describe('Android durable recovery headless task', () => {
  it('decodes only the exact native payload contract', () => {
    expect(decodeAndroidDurableHeadlessPayload(payload())).toEqual(payload());
    expect(() => decodeAndroidDurableHeadlessPayload({ ...payload(), unexpected: true })).toThrow(
      'android-durable-headless-payload-invalid',
    );
    expect(() => decodeAndroidDurableHeadlessPayload({ ...payload(), attempt: 0 })).toThrow(
      'android-durable-headless-payload-invalid',
    );
  });

  it('reports a completed receipt against the exact native attempt', async () => {
    const dependencies = dependencyHarness(completedOutcome());

    await runAndroidDurableRecoveryHeadlessTask(payload(), dependencies);

    expect(dependencies.coordinate).toHaveBeenCalledWith({
      runId: 'run-1',
      expectedGeneration: {
        controlEpoch: 2,
        updatedAt: 90,
        snapshotDigest: 'a'.repeat(64),
      },
    });
    expect(dependencies.complete).toHaveBeenCalledWith(attemptPointer(), 'd'.repeat(64), 200);
    expect(dependencies.retry).not.toHaveBeenCalled();
  });

  it('completes a pending journal generation so its continuation can schedule the successor', async () => {
    const remoteRetry = dependencyHarness({
      ...completedOutcome(),
      kind: 'pending' as const,
      reason: 'remote_still_pending' as const,
      retryAt: 60_000,
    });
    await runAndroidDurableRecoveryHeadlessTask(payload(), remoteRetry);
    expect(remoteRetry.complete).toHaveBeenCalledWith(attemptPointer(), 'd'.repeat(64), 200);
    expect(remoteRetry.retry).not.toHaveBeenCalled();
  });

  it('turns thrown and deferred transient coordination into durable retry state', async () => {
    const thrown = dependencyHarness(completedOutcome());
    thrown.coordinate.mockRejectedValue(new Error('provider unavailable'));
    await runAndroidDurableRecoveryHeadlessTask(payload(), thrown);
    expect(thrown.retry).toHaveBeenCalledWith(
      attemptPointer(),
      10_200,
      'transient_unavailable',
      200,
    );

    const deferred = dependencyHarness({
      kind: 'deferred' as const,
      reason: 'query_unavailable' as const,
      runId: 'run-1',
      commandKind: 'reconcile_external_handles' as const,
      controlEpoch: 2,
      snapshotDigest: 'a'.repeat(64),
      commandDigest: 'b'.repeat(64),
      dispatchId: null,
      dispatchDigest: null,
      fenceId: null,
      fenceDigest: null,
    });
    await runAndroidDurableRecoveryHeadlessTask(payload(), deferred);
    expect(deferred.retry).toHaveBeenCalledWith(
      attemptPointer(),
      10_200,
      'transient_unavailable',
      200,
    );
  });

  it('blocks stale generations and propagates authoritative cancellation', async () => {
    const changed = dependencyHarness({
      kind: 'deferred' as const,
      reason: 'generation_changed' as const,
      runId: 'run-1',
      commandKind: 'reconcile_external_handles' as const,
      controlEpoch: 2,
      snapshotDigest: 'a'.repeat(64),
      commandDigest: 'b'.repeat(64),
      dispatchId: null,
      dispatchDigest: null,
      fenceId: null,
      fenceDigest: null,
    });
    await runAndroidDurableRecoveryHeadlessTask(payload(), changed);
    expect(changed.block).toHaveBeenCalledWith(attemptPointer(), 'generation_changed', 200);

    const cancelled = dependencyHarness({
      kind: 'blocked' as const,
      reason: 'cancelled' as const,
      sourceReason: null,
      runId: 'run-1',
      commandKind: 'reconcile_external_handles' as const,
      controlEpoch: 2,
      snapshotDigest: 'a'.repeat(64),
      commandDigest: 'b'.repeat(64),
      dispatchId: null,
      dispatchDigest: null,
      fenceId: null,
      fenceDigest: null,
    });
    await runAndroidDurableRecoveryHeadlessTask(payload(), cancelled);
    expect(cancelled.cancel).toHaveBeenCalledWith(generationPointer(), 200);
  });

  it('blocks a coordinator receipt from another generation', async () => {
    const dependencies = dependencyHarness({
      ...completedOutcome(),
      commandDigest: 'e'.repeat(64),
    });

    await runAndroidDurableRecoveryHeadlessTask(payload(), dependencies);
    expect(dependencies.complete).not.toHaveBeenCalled();
    expect(dependencies.retry).not.toHaveBeenCalled();
    expect(dependencies.block).toHaveBeenCalledWith(attemptPointer(), 'generation_changed', 200);
  });

  it('registers the Android headless entrypoint under the exact native key', () => {
    const registerHeadlessTask = jest.fn();
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({
        AppRegistry: { registerHeadlessTask },
        Platform: { OS: 'android' },
      }));
      registerAndroidDurableRecoveryHeadlessTask();
    });

    expect(registerHeadlessTask).toHaveBeenCalledWith('KaviDurableRecovery', expect.any(Function));
    jest.unmock('react-native');
  });

  function dependencyHarness(
    outcome: ReturnType<typeof completedOutcome> | Record<string, unknown>,
  ) {
    const read = jest.fn().mockResolvedValue({
      schema: 1 as const,
      status: 'found' as const,
      record: record(),
    });
    const acceptedResult = {
      schema: 1 as const,
      status: 'accepted' as const,
      reason: null,
      record: record(),
    };
    return {
      now: jest.fn(() => 200),
      coordinate: jest.fn().mockResolvedValue(outcome),
      read,
      complete: jest.fn().mockResolvedValue(acceptedResult),
      retry: jest.fn().mockResolvedValue(acceptedResult),
      block: jest.fn().mockResolvedValue(acceptedResult),
      cancel: jest.fn().mockResolvedValue(acceptedResult),
    };
  }

  function payload() {
    return {
      schema: 1 as const,
      workId: '00000000-0000-4000-8000-000000000041',
      runId: 'run-1',
      controlEpoch: 2,
      snapshotUpdatedAtMillis: 90,
      snapshotDigest: 'a'.repeat(64),
      commandKind: 'reconcile_external_handles' as const,
      commandDigest: 'b'.repeat(64),
      attempt: 1,
    };
  }

  function generationPointer() {
    return {
      schema: 1 as const,
      runId: 'run-1',
      controlEpoch: 2,
      snapshotUpdatedAtMillis: 90,
      snapshotDigest: 'a'.repeat(64),
      commandDigest: 'b'.repeat(64),
    };
  }

  function attemptPointer() {
    const { schema: _schema, ...generation } = generationPointer();
    return { schema: 1 as const, generation, attempt: 1 };
  }

  function completedOutcome() {
    return {
      kind: 'completed' as const,
      runId: 'run-1',
      commandKind: 'reconcile_external_handles' as const,
      controlEpoch: 2,
      snapshotDigest: 'a'.repeat(64),
      commandDigest: 'b'.repeat(64),
      authorityDigest: 'c'.repeat(64),
      dispatchId: 'dispatch-1',
      dispatchDigest: 'e'.repeat(64),
      fenceId: 'fence-1',
      fenceDigest: 'f'.repeat(64),
      receiptId: 'receipt-1',
      receiptDigest: 'd'.repeat(64),
    };
  }

  function record() {
    return {
      request: {
        schema: 1 as const,
        durabilityClass: 'external_durable_operation' as const,
        identity: {
          runId: 'run-1',
          controlEpoch: 2,
          snapshotUpdatedAtMillis: 90,
          snapshotDigest: 'a'.repeat(64),
          commandKind: 'reconcile_external_handles' as const,
          commandDigest: 'b'.repeat(64),
        },
        constraints: {
          network: 'connected' as const,
          requiresCharging: false,
          requiresBatteryNotLow: true,
          requiresStorageNotLow: true,
          requiresDeviceIdle: false as const,
          earliestStartAtMillis: 100,
        },
        retryPolicy: {
          maxAttempts: 3,
          backoffPolicy: 'exponential' as const,
          initialBackoffMillis: 10_000,
        },
        requestedAtMillis: 100,
      },
      schedulerKind: 'work_manager_one_time' as const,
      uniqueWorkName: 'kavi.durable-recovery.v1.run-1',
      platformWorkId: '00000000-0000-4000-8000-000000000041',
      state: 'running' as const,
      attempt: 1,
      nextAttemptAtMillis: null,
      failureReason: null,
      receiptDigest: null,
      revision: 2,
      updatedAtMillis: 100,
    };
  }
});
