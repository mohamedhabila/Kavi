describe('Android durable execution native bridge', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('react-native');
    jest.clearAllMocks();
  });

  function loadBridge(options?: { platform?: string; nativeModule?: Record<string, unknown> }) {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      NativeModules: options?.nativeModule ? { KaviDurableExecution: options.nativeModule } : {},
      Platform: { OS: options?.platform ?? 'android' },
    }));
    return require('../../src/services/executionJournal/androidDurableExecutionNative') as typeof import('../../src/services/executionJournal/androidDurableExecutionNative');
  }

  it('fails closed when platform, module, or bridge schema is wrong', async () => {
    expect(loadBridge().isAndroidDurableExecutionAvailable()).toBe(false);
    expect(
      loadBridge({
        platform: 'ios',
        nativeModule: nativeModule(),
      }).isAndroidDurableExecutionAvailable(),
    ).toBe(false);
    expect(
      loadBridge({
        nativeModule: { ...nativeModule(), bridgeSchema: 2 },
      }).isAndroidDurableExecutionAvailable(),
    ).toBe(false);

    await expect(loadBridge().readAndroidDurableExecution('run-1')).rejects.toThrow(
      'android-durable-execution-native-module-unavailable',
    );
  });

  it('delegates an exact request and decodes the complete native record', async () => {
    const module = nativeModule();
    const bridge = loadBridge({ nativeModule: module });
    const request = durableRequest();

    await expect(bridge.enqueueAndroidDurableExecution(request)).resolves.toEqual(adapterResult());
    expect(module.enqueue).toHaveBeenCalledWith(request);
    await expect(bridge.readAndroidDurableExecution('run-1')).resolves.toEqual({
      schema: 1,
      status: 'found',
      record: durableRecord(),
    });
  });

  it('rejects malformed native results instead of inferring success', async () => {
    const module = nativeModule({
      enqueue: jest.fn().mockResolvedValue({
        ...adapterResult(),
        status: 'completed',
      }),
    });
    const bridge = loadBridge({ nativeModule: module });

    await expect(bridge.enqueueAndroidDurableExecution(durableRequest())).rejects.toThrow(
      'android-durable-native-contract-violation',
    );
  });

  it('passes exact attempt fences and closed transition reasons', async () => {
    const module = nativeModule();
    const bridge = loadBridge({ nativeModule: module });
    const attemptPointer = {
      schema: 1 as const,
      generation: {
        runId: 'run-1',
        controlEpoch: 2,
        snapshotUpdatedAtMillis: 90,
        snapshotDigest: 'a'.repeat(64),
        commandDigest: 'b'.repeat(64),
      },
      attempt: 1,
    };

    await bridge.completeAndroidDurableExecution(attemptPointer, 'd'.repeat(64), 200);
    await bridge.retryAndroidDurableExecution(attemptPointer, 10_200, 'remote_still_pending', 200);
    await bridge.blockAndroidDurableExecution(attemptPointer, 'authority_changed', 200);

    expect(module.complete).toHaveBeenCalledWith(attemptPointer, 'd'.repeat(64), 200);
    expect(module.scheduleRetry).toHaveBeenCalledWith(
      attemptPointer,
      10_200,
      'remote_still_pending',
      200,
    );
    expect(module.block).toHaveBeenCalledWith(attemptPointer, 'authority_changed', 200);
  });

  it('requires the exact candidate task contract and acknowledgement owner', async () => {
    const module = nativeModule();
    const bridge = loadBridge({ nativeModule: module });

    await expect(
      bridge.acknowledgeAndroidDurableCandidateWake(
        '00000000-0000-4000-8000-000000000032',
        '00000000-0000-4000-8000-000000000033',
        'run-1',
        'completed',
      ),
    ).resolves.toBeUndefined();
    expect(module.acknowledgeCandidateWake).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000032',
      '00000000-0000-4000-8000-000000000033',
      'run-1',
      'completed',
    );

    const rejected = loadBridge({
      nativeModule: nativeModule({
        acknowledgeCandidateWake: jest.fn().mockResolvedValue(false),
      }),
    });
    await expect(
      rejected.acknowledgeAndroidDurableCandidateWake(
        '00000000-0000-4000-8000-000000000032',
        '00000000-0000-4000-8000-000000000033',
        'run-1',
        'retry',
      ),
    ).rejects.toThrow('android-durable-candidate-acknowledgement-rejected');
  });

  function nativeModule(overrides: Record<string, unknown> = {}) {
    return {
      bridgeSchema: 1,
      headlessTaskKey: 'KaviDurableRecovery',
      candidateTaskKey: 'KaviDurableCandidateSchedule',
      enqueue: jest.fn().mockResolvedValue(adapterResult()),
      cancel: jest.fn().mockResolvedValue(adapterResult()),
      complete: jest.fn().mockResolvedValue(adapterResult()),
      scheduleRetry: jest.fn().mockResolvedValue(adapterResult()),
      block: jest.fn().mockResolvedValue(adapterResult()),
      releaseTerminal: jest.fn().mockResolvedValue(adapterResult()),
      getRecord: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'found',
        record: durableRecord(),
      }),
      acknowledgeCandidateWake: jest.fn().mockResolvedValue(true),
      ...overrides,
    };
  }

  function durableRequest() {
    return {
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
    };
  }

  function durableRecord() {
    return {
      request: durableRequest(),
      schedulerKind: 'work_manager_one_time',
      uniqueWorkName: 'kavi.durable-recovery.v1.run-1',
      platformWorkId: '00000000-0000-4000-8000-000000000031',
      state: 'enqueued',
      attempt: 0,
      nextAttemptAtMillis: null,
      failureReason: null,
      receiptDigest: null,
      revision: 1,
      updatedAtMillis: 100,
    };
  }

  function adapterResult() {
    return {
      schema: 1,
      status: 'accepted',
      reason: null,
      record: durableRecord(),
    };
  }
});
