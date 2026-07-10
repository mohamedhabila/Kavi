describe('durable platform native bridge', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('react-native');
    jest.clearAllMocks();
  });

  function loadBridge(nativeModule?: Record<string, any>) {
    jest.unmock('react-native');
    let eventListener: ((event: unknown) => void) | undefined;
    const subscription = { remove: jest.fn() };
    const addListener = jest.fn((_name: string, listener: (event: unknown) => void) => {
      eventListener = listener;
      return subscription;
    });
    const NativeEventEmitter = jest.fn().mockImplementation(() => ({ addListener }));
    jest.doMock('react-native', () => ({
      NativeEventEmitter,
      NativeModules: nativeModule ? { KaviDurableExecution: nativeModule } : {},
    }));
    const mod = require('../../src/services/executionJournal/durablePlatformBridge');
    return {
      mod,
      NativeEventEmitter,
      addListener,
      subscription,
      emit: (event: unknown) => eventListener?.(event),
    };
  }

  function request(overrides: Record<string, unknown> = {}) {
    return {
      schema: 1,
      durabilityClass: 'user_initiated_continuable',
      identity: {
        runId: 'run-1',
        controlEpoch: 1,
        snapshotUpdatedAtMillis: 900,
        snapshotDigest: 'a'.repeat(64),
        commandKind: 'resume_model_step',
        commandDigest: 'b'.repeat(64),
      },
      constraints: {
        network: 'connected',
        requiresCharging: false,
        requiresBatteryNotLow: false,
        requiresStorageNotLow: false,
        requiresDeviceIdle: false,
        earliestStartAtMillis: 1_000,
      },
      retryPolicy: {
        maxAttempts: 3,
        backoffPolicy: 'exponential',
        initialBackoffMillis: 10_000,
      },
      requestedAtMillis: 1_000,
      ...overrides,
    };
  }

  function iosRecord() {
    return {
      request: request(),
      schedulerKind: 'continued_processing',
      taskIdentifier: 'com.kavi.app.durable-continuation.abc',
      state: 'running',
      attempt: 1,
      nextAttemptAtMillis: null,
      failureReason: null,
      receiptDigest: null,
      progressCompleted: 10,
      progressTotal: 100,
      lastCheckpointAtMillis: 1_100,
      revision: 3,
      updatedAtMillis: 1_100,
    };
  }

  function adapterResult(record = iosRecord()) {
    return { schema: 1, status: 'accepted', reason: null, record };
  }

  function nativeModule(overrides: Record<string, any> = {}) {
    return {
      bridgeSchema: 1,
      enqueue: jest.fn().mockResolvedValue(adapterResult()),
      cancel: jest.fn().mockResolvedValue(adapterResult()),
      complete: jest.fn().mockResolvedValue(adapterResult()),
      scheduleRetry: jest.fn().mockResolvedValue(adapterResult()),
      block: jest.fn().mockResolvedValue(adapterResult()),
      releaseTerminal: jest.fn().mockResolvedValue(adapterResult()),
      getRecord: jest.fn().mockResolvedValue({ schema: 1, status: 'found', record: iosRecord() }),
      reconcileOutboxes: jest.fn().mockResolvedValue({
        schema: 1,
        scheduling: { status: 'completed', outcomes: [] },
        cancellation: { status: 'completed', outcomes: [] },
      }),
      ...overrides,
    };
  }

  it('fails closed when the module schema or required methods are missing', () => {
    expect(loadBridge().mod.getDurablePlatformExecutionBridge()).toBeNull();
    expect(loadBridge({ bridgeSchema: 2 }).mod.getDurablePlatformExecutionBridge()).toBeNull();
    expect(
      loadBridge(nativeModule({ complete: undefined })).mod.getDurablePlatformExecutionBridge(),
    ).toBeNull();
  });

  it('delegates exact requests and validates native records before returning them', async () => {
    const native = nativeModule();
    const bridge = loadBridge(native).mod.getDurablePlatformExecutionBridge();
    const input = request();

    await expect(bridge.enqueue(input)).resolves.toEqual(adapterResult());
    expect(native.enqueue).toHaveBeenCalledWith(input);
    await expect(bridge.getRecord('run-1')).resolves.toEqual({
      schema: 1,
      status: 'found',
      record: iosRecord(),
    });
  });

  it('rejects malformed or widened native results', async () => {
    const native = nativeModule({
      enqueue: jest.fn().mockResolvedValue({ ...adapterResult(), unexpected: true }),
      getRecord: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'found',
        record: { ...iosRecord(), progressTotal: 9, progressCompleted: 10 },
      }),
    });
    const bridge = loadBridge(native).mod.getDurablePlatformExecutionBridge();

    await expect(bridge.enqueue(request())).rejects.toThrow(
      'durable-platform-bridge-invalid-result',
    );
    await expect(bridge.getRecord('run-1')).rejects.toThrow(
      'durable-platform-bridge-invalid-record',
    );
  });

  it('exposes progress, checkpoint, and pending launch methods only when native supports them', async () => {
    const native = nativeModule({
      wakeEventName: 'KaviDurableExecutionWake',
      supportsProgressCheckpoint: true,
      reportProgress: jest.fn().mockResolvedValue(adapterResult()),
      checkpoint: jest.fn().mockResolvedValue(adapterResult()),
      getPendingLaunches: jest.fn().mockResolvedValue({
        schema: 1,
        status: 'available',
        events: [
          {
            schema: 1,
            trigger: 'relaunch_reconciliation',
            disposition: 'recover',
            record: iosRecord(),
          },
        ],
      }),
    });
    const bridge = loadBridge(native).mod.getDurablePlatformExecutionBridge();

    expect(bridge.supportsProgressCheckpoint).toBe(true);
    await expect(bridge.reportProgress({}, 1, 10, 2_000)).resolves.toEqual(adapterResult());
    await expect(bridge.getPendingLaunches(10)).resolves.toEqual(
      expect.objectContaining({ status: 'available' }),
    );
  });

  it('does not invent iOS methods on a platform module that omits them', () => {
    const bridge = loadBridge(nativeModule()).mod.getDurablePlatformExecutionBridge();
    expect(bridge.supportsProgressCheckpoint).toBe(false);
    expect(bridge.reportProgress).toBeUndefined();
    expect(bridge.getPendingLaunches).toBeUndefined();
  });

  it('validates iOS wake events and surfaces malformed delivery to the recovery owner', () => {
    const native = nativeModule({
      wakeEventName: 'KaviDurableExecutionWake',
      getPendingLaunches: jest.fn(),
    });
    const context = loadBridge(native);
    const onEvent = jest.fn();
    const onInvalid = jest.fn();
    const subscription = context.mod.subscribeToIOSDurableWakeEvents(onEvent, onInvalid);

    context.emit({
      schema: 1,
      trigger: 'platform_launch',
      disposition: 'recover',
      record: iosRecord(),
    });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'platform_launch' }));
    const interrupted = {
      ...iosRecord(),
      state: 'expired',
      failureReason: 'continued_processing_interrupted',
      revision: 4,
    };
    context.emit({
      schema: 1,
      trigger: 'platform_expiration',
      disposition: 'require_user_action',
      record: interrupted,
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: 'require_user_action' }),
    );
    context.emit({
      schema: 1,
      trigger: 'platform_expiration',
      disposition: 'recover',
      record: interrupted,
    });
    expect(onInvalid).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'durable-platform-bridge-invalid-wake' }),
    );
    context.emit({
      schema: 1,
      trigger: 'platform_launch',
      disposition: 'recover',
      record: null,
    });
    expect(onInvalid).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'durable-platform-bridge-invalid-record' }),
    );
    expect(context.NativeEventEmitter).toHaveBeenCalledWith(native);
    subscription.remove();
    expect(context.subscription.remove).toHaveBeenCalledTimes(1);
  });

  it('accepts the existing Android record shape through the same common boundary', async () => {
    const androidRecord = {
      request: request({ durabilityClass: 'external_durable_operation' }),
      schedulerKind: 'work_manager_one_time',
      uniqueWorkName: 'kavi.durable-recovery.v1.run-1',
      platformWorkId: '76095f07-a8c9-4fb1-a54c-e303bb1f08ac',
      state: 'enqueued',
      attempt: 0,
      nextAttemptAtMillis: null,
      failureReason: null,
      receiptDigest: null,
      revision: 1,
      updatedAtMillis: 1_000,
    };
    const native = nativeModule({
      enqueue: jest.fn().mockResolvedValue(adapterResult(androidRecord)),
    });
    const bridge = loadBridge(native).mod.getDurablePlatformExecutionBridge();

    await expect(bridge.enqueue(request())).resolves.toEqual(adapterResult(androidRecord));
  });
});
