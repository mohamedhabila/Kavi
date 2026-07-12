const mockWaitForRequiredStoreHydration = jest.fn().mockResolvedValue(undefined);
const mockWaitForPersistedAgentRecoveryReadiness = jest.fn().mockResolvedValue(undefined);
const mockReconcileStrandedAttempts = jest.fn().mockReturnValue([]);
const mockRequestPersistence = jest.fn();
const mockFlushSchedulerStorePersistenceNow = jest.fn().mockResolvedValue(undefined);
const mockDrainSchedulerTerminalReports = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/store/persistHydration', () => ({
  waitForRequiredStoreHydration: (...args: any[]) => mockWaitForRequiredStoreHydration(...args),
}));
jest.mock('../../src/store/useSettingsStore', () => ({ useSettingsStore: {} }));
jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: {
    getState: () => ({
      reconcileStrandedAttempts: mockReconcileStrandedAttempts,
      requestPersistence: mockRequestPersistence,
    }),
  },
}));
jest.mock('../../src/services/startupRecovery', () => ({
  waitForPersistedAgentRecoveryReadiness: (...args: any[]) =>
    mockWaitForPersistedAgentRecoveryReadiness(...args),
}));
jest.mock('../../src/services/scheduler/persistence', () => ({
  flushSchedulerStorePersistenceNow: (...args: any[]) =>
    mockFlushSchedulerStorePersistenceNow(...args),
}));
jest.mock('../../src/services/scheduler/terminalReportProcessor', () => ({
  drainSchedulerTerminalReports: (...args: any[]) => mockDrainSchedulerTerminalReports(...args),
}));
jest.mock('../../src/services/scheduler/traceStore', () => ({
  useExecutionTraceStore: {},
}));

import {
  ensureSchedulerMaintenanceReady,
  ensureSchedulerRuntimeReady,
  resetSchedulerRuntimeReadinessForTests,
  setSchedulerExecutionReadinessBarrier,
} from '../../src/services/scheduler/runtimeReadiness';

describe('scheduler runtime readiness', () => {
  const ambiguousJob = () => ({
    id: 'job-1',
    name: 'Recovered job',
    lastError:
      'A previous scheduled attempt ended without a durable terminal record; replay was suppressed.',
    lastAmbiguousAttemptId: 'attempt-1',
    lastAmbiguousStartedAtMs: 1_700_000_000_000,
    lastAmbiguousAttemptNumber: 2,
    lastSettledAttemptId: 'attempt-1',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetSchedulerRuntimeReadinessForTests();
    mockWaitForRequiredStoreHydration.mockResolvedValue(undefined);
    mockWaitForPersistedAgentRecoveryReadiness.mockResolvedValue(undefined);
    mockReconcileStrandedAttempts.mockReturnValue([]);
    mockFlushSchedulerStorePersistenceNow.mockResolvedValue(undefined);
    mockDrainSchedulerTerminalReports.mockResolvedValue(undefined);
  });

  it('waits for scheduler, settings, and recovered chat state before reconciliation', async () => {
    let releaseHydration!: () => void;
    mockWaitForRequiredStoreHydration.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseHydration = resolve;
        }),
    );

    const readiness = ensureSchedulerRuntimeReady();
    await Promise.resolve();
    expect(mockReconcileStrandedAttempts).not.toHaveBeenCalled();

    releaseHydration();
    await readiness;
    expect(mockWaitForRequiredStoreHydration).toHaveBeenCalledTimes(3);
    expect(mockWaitForPersistedAgentRecoveryReadiness).toHaveBeenCalledTimes(1);
    expect(mockReconcileStrandedAttempts).toHaveBeenCalledTimes(1);
  });

  it('orders headless projection recovery before stranded-attempt reconciliation', async () => {
    let releaseProjectionRecovery!: () => void;
    mockWaitForPersistedAgentRecoveryReadiness.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseProjectionRecovery = resolve;
        }),
    );

    const maintenance = ensureSchedulerMaintenanceReady();
    await Promise.resolve();

    expect(mockReconcileStrandedAttempts).not.toHaveBeenCalled();
    releaseProjectionRecovery();
    await maintenance;

    expect(mockWaitForRequiredStoreHydration).toHaveBeenCalledTimes(2);
    expect(mockWaitForPersistedAgentRecoveryReadiness).toHaveBeenCalledTimes(1);
    expect(mockReconcileStrandedAttempts).toHaveBeenCalledTimes(1);
  });

  it('reuses the completed projection-recovery barrier for foreground readiness', async () => {
    await ensureSchedulerMaintenanceReady();
    await ensureSchedulerRuntimeReady();

    expect(mockWaitForRequiredStoreHydration).toHaveBeenCalledTimes(3);
    expect(mockWaitForPersistedAgentRecoveryReadiness).toHaveBeenCalledTimes(1);
    expect(mockReconcileStrandedAttempts).toHaveBeenCalledTimes(1);
  });

  it('waits for the configured execution readiness barrier', async () => {
    let releaseBarrier!: () => void;
    let ready = false;
    setSchedulerExecutionReadinessBarrier(
      () => new Promise<void>((resolve) => (releaseBarrier = resolve)),
    );

    const readiness = ensureSchedulerRuntimeReady().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    releaseBarrier();
    await readiness;
    expect(ready).toBe(true);
  });

  it('persists stranded-attempt reconciliation before becoming ready', async () => {
    const job = ambiguousJob();
    mockReconcileStrandedAttempts.mockReturnValue([job]);

    await ensureSchedulerRuntimeReady();

    expect(mockFlushSchedulerStorePersistenceNow).toHaveBeenCalledTimes(1);
    expect(mockDrainSchedulerTerminalReports).toHaveBeenCalledTimes(1);
    expect(mockFlushSchedulerStorePersistenceNow.mock.invocationCallOrder[0]).toBeLessThan(
      mockDrainSchedulerTerminalReports.mock.invocationCallOrder[0],
    );
  });

  it('keeps fencing an in-memory reconciliation after its first write fails', async () => {
    const job = ambiguousJob();
    mockReconcileStrandedAttempts.mockReturnValueOnce([job]).mockReturnValueOnce([]);
    mockFlushSchedulerStorePersistenceNow
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(ensureSchedulerRuntimeReady()).rejects.toThrow('disk unavailable');
    await expect(ensureSchedulerRuntimeReady()).resolves.toBeUndefined();

    expect(mockFlushSchedulerStorePersistenceNow).toHaveBeenCalledTimes(2);
    expect(mockRequestPersistence).toHaveBeenCalledTimes(1);
  });

  it('drains the durable terminal outbox after reconciliation', async () => {
    const job = ambiguousJob();
    mockReconcileStrandedAttempts.mockReturnValue([job]);

    await ensureSchedulerRuntimeReady();

    expect(mockDrainSchedulerTerminalReports).toHaveBeenCalledTimes(1);
  });

  it('keeps maintenance available while terminal delivery remains queued', async () => {
    const job = ambiguousJob();
    mockReconcileStrandedAttempts.mockReturnValue([job]);
    mockDrainSchedulerTerminalReports.mockRejectedValueOnce(new Error('delivery unavailable'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(ensureSchedulerMaintenanceReady()).resolves.toBeUndefined();

    expect(mockDrainSchedulerTerminalReports).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('allows a later readiness attempt after a failed recovery', async () => {
    mockWaitForPersistedAgentRecoveryReadiness.mockRejectedValueOnce(new Error('recovery failed'));

    await expect(ensureSchedulerRuntimeReady()).rejects.toThrow('recovery failed');
    await expect(ensureSchedulerRuntimeReady()).resolves.toBeUndefined();
    expect(mockWaitForPersistedAgentRecoveryReadiness).toHaveBeenCalledTimes(2);
  });
});
