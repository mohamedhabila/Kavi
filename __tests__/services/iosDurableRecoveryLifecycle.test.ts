import type {
  DurablePlatformExecutionBridge,
  IOSDurablePlatformRecord,
  IOSDurableWakeEvent,
} from '../../src/services/executionJournal/durablePlatformBridgeTypes';
import {
  IOSDurableRecoveryLifecycle,
  type IOSDurableRecoveryLifecycleDependencies,
} from '../../src/services/executionJournal/iosDurableRecoveryLifecycle';
import type { IOSDurableWakeRunnerOutcome } from '../../src/services/executionJournal/iosDurableWakeRunner';

function record(runId = 'run-1'): IOSDurablePlatformRecord {
  return {
    request: {
      schema: 1,
      durabilityClass: 'external_durable_operation',
      identity: {
        runId,
        controlEpoch: 1,
        snapshotUpdatedAtMillis: 1_000,
        snapshotDigest: 'a'.repeat(64),
        commandKind: 'reconcile_external_handles',
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
        maxAttempts: 5,
        backoffPolicy: 'exponential',
        initialBackoffMillis: 30_000,
      },
      requestedAtMillis: 1_000,
    },
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
    updatedAtMillis: 1_500,
  };
}

function event(runId = 'run-1'): IOSDurableWakeEvent {
  return {
    schema: 1,
    trigger: 'relaunch_reconciliation',
    disposition: 'recover',
    record: record(runId),
  };
}

function bridge(events: IOSDurableWakeEvent[] = []): DurablePlatformExecutionBridge {
  return {
    bridgeSchema: 1,
    wakeEventName: 'KaviDurableExecutionWake',
    supportsProgressCheckpoint: false,
    enqueue: jest.fn(),
    cancel: jest.fn(),
    complete: jest.fn(),
    scheduleRetry: jest.fn(),
    block: jest.fn(),
    releaseTerminal: jest.fn(),
    getRecord: jest.fn(),
    reconcileOutboxes: jest.fn(),
    getPendingLaunches: jest.fn().mockResolvedValue({
      schema: 1,
      status: 'available',
      events,
    }),
  };
}

function dependencies(
  nativeBridge: DurablePlatformExecutionBridge,
  overrides: Partial<IOSDurableRecoveryLifecycleDependencies> = {},
) {
  let onEvent: ((event: IOSDurableWakeEvent) => void) | undefined;
  let onInvalid: ((error: Error) => void) | undefined;
  const subscription = { remove: jest.fn() };
  const deps: IOSDurableRecoveryLifecycleDependencies = {
    platform: 'ios',
    getBridge: () => nativeBridge,
    subscribe: jest.fn((eventHandler, invalidHandler) => {
      onEvent = eventHandler;
      onInvalid = invalidHandler;
      return subscription;
    }),
    runEvent: jest.fn().mockResolvedValue({
      kind: 'retry_scheduled',
      runId: 'run-1',
      retryAt: 30_000,
    }),
    scheduleSlice: jest.fn().mockResolvedValue({ outcomes: [], nextAfter: null }),
    yieldToRuntime: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn(),
    ...overrides,
  };
  return {
    deps,
    subscription,
    emit: (wake: IOSDurableWakeEvent) => onEvent?.(wake),
    invalidate: (error: Error) => onInvalid?.(error),
  };
}

describe('iOS durable recovery lifecycle', () => {
  it('is inert on unsupported platforms', async () => {
    const nativeBridge = bridge([event()]);
    const context = dependencies(nativeBridge, { platform: 'android' });
    const lifecycle = new IOSDurableRecoveryLifecycle(context.deps);

    lifecycle.start();
    await lifecycle.reconcile('startup');

    expect(context.deps.subscribe).not.toHaveBeenCalled();
    expect(nativeBridge.getPendingLaunches).not.toHaveBeenCalled();
    expect(context.deps.scheduleSlice).not.toHaveBeenCalled();
  });

  it('subscribes once and replays startup and foreground pending wakes', async () => {
    const nativeBridge = bridge([event()]);
    const context = dependencies(nativeBridge);
    const lifecycle = new IOSDurableRecoveryLifecycle(context.deps);

    lifecycle.start();
    lifecycle.start();
    await lifecycle.reconcile('startup');
    await lifecycle.reconcile('foreground');

    expect(context.deps.subscribe).toHaveBeenCalledTimes(1);
    expect(nativeBridge.getPendingLaunches).toHaveBeenCalledTimes(2);
    expect(context.deps.runEvent).toHaveBeenCalledTimes(2);
    expect(context.deps.scheduleSlice).toHaveBeenCalledTimes(2);
    lifecycle.dispose();
    expect(context.subscription.remove).toHaveBeenCalledTimes(1);
  });

  it('deduplicates the same emitted and replayed generation while it is in flight', async () => {
    const wake = event();
    let complete: (() => void) | undefined;
    const runEvent = jest.fn(
      () =>
        new Promise<IOSDurableWakeRunnerOutcome>((resolve) => {
          complete = () => resolve({ kind: 'retry_scheduled', runId: 'run-1', retryAt: 30_000 });
        }),
    );
    const nativeBridge = bridge([wake]);
    const context = dependencies(nativeBridge, { runEvent });
    const lifecycle = new IOSDurableRecoveryLifecycle(context.deps);
    lifecycle.start();

    const replay = lifecycle.reconcile('startup');
    context.emit(wake);
    await Promise.resolve();
    expect(runEvent).toHaveBeenCalledTimes(1);
    complete?.();
    await replay;
  });

  it('serializes different generations for one run but allows independent run owners', async () => {
    const calls: string[] = [];
    const gates = new Map<string, () => void>();
    let markSecondGenerationStarted: (() => void) | undefined;
    const secondGenerationStarted = new Promise<void>((resolve) => {
      markSecondGenerationStarted = resolve;
    });
    const runEvent = jest.fn(
      (wake: IOSDurableWakeEvent) =>
        new Promise<IOSDurableWakeRunnerOutcome>((resolve) => {
          const key = `${wake.record.request.identity.runId}:${wake.record.revision}`;
          calls.push(`start:${key}`);
          if (key === 'run-1:3') markSecondGenerationStarted?.();
          gates.set(key, () => {
            calls.push(`finish:${key}`);
            resolve({
              kind: 'retry_scheduled',
              runId: wake.record.request.identity.runId,
              retryAt: 1,
            });
          });
        }),
    );
    const nativeBridge = bridge([]);
    const context = dependencies(nativeBridge, { runEvent });
    const lifecycle = new IOSDurableRecoveryLifecycle(context.deps);
    lifecycle.start();
    const nextSameRun = {
      ...event(),
      record: { ...record(), revision: 3 },
    };
    context.emit(event());
    context.emit(nextSameRun);
    context.emit(event('run-2'));
    await Promise.resolve();

    expect(calls).toEqual(['start:run-1:2', 'start:run-2:2']);
    gates.get('run-1:2')?.();
    await secondGenerationStarted;
    expect(calls).toContain('start:run-1:3');
    gates.get('run-1:3')?.();
    gates.get('run-2:2')?.();
    await Promise.resolve();
  });

  it('continues every candidate page cooperatively and surfaces attention outcomes', async () => {
    const nativeBridge = bridge([]);
    const scheduleSlice = jest
      .fn()
      .mockResolvedValueOnce({
        outcomes: [{ kind: 'deferred', runId: 'run-1', reason: 'store_unavailable' }],
        nextAfter: '[1000,"run-1"]',
      })
      .mockResolvedValueOnce({ outcomes: [], nextAfter: null });
    const context = dependencies(nativeBridge, { scheduleSlice });
    const lifecycle = new IOSDurableRecoveryLifecycle(context.deps);

    await lifecycle.reconcile('foreground');

    expect(scheduleSlice).toHaveBeenNthCalledWith(1, { limit: 25 });
    expect(scheduleSlice).toHaveBeenNthCalledWith(2, {
      limit: 25,
      after: '[1000,"run-1"]',
    });
    expect(context.deps.yieldToRuntime).toHaveBeenCalledTimes(1);
    expect(context.deps.warn).toHaveBeenCalledWith(
      '[durability] iOS foreground recovery scan needs attention',
    );
  });

  it('surfaces malformed native events and unavailable replay without crashing startup', async () => {
    const nativeBridge = bridge([]);
    jest.mocked(nativeBridge.getPendingLaunches!).mockResolvedValue({
      schema: 1,
      status: 'unavailable',
      events: [],
    });
    const context = dependencies(nativeBridge);
    const lifecycle = new IOSDurableRecoveryLifecycle(context.deps);
    lifecycle.start();
    context.invalidate(new Error('bad wake'));
    await lifecycle.reconcile('startup');

    expect(context.deps.warn).toHaveBeenCalledWith(
      '[durability] Invalid iOS durable wake event',
      expect.any(Error),
    );
    expect(context.deps.warn).toHaveBeenCalledWith(
      '[durability] iOS startup pending-wake store unavailable',
    );
  });
});
