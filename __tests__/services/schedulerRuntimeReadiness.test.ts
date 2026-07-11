const mockWaitForStoreHydration = jest.fn().mockResolvedValue(undefined);
const mockWaitForPersistedAgentRecoveryReadiness = jest.fn().mockResolvedValue(undefined);
const mockReconcileStrandedAttempts = jest.fn().mockReturnValue([]);
const mockFlushSchedulerStorePersistenceNow = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/store/persistHydration', () => ({
  waitForStoreHydration: (...args: any[]) => mockWaitForStoreHydration(...args),
}));
jest.mock('../../src/store/useSettingsStore', () => ({ useSettingsStore: {} }));
jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: {
    getState: () => ({ reconcileStrandedAttempts: mockReconcileStrandedAttempts }),
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

import {
  ensureSchedulerRuntimeReady,
  resetSchedulerRuntimeReadinessForTests,
} from '../../src/services/scheduler/runtimeReadiness';

describe('scheduler runtime readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSchedulerRuntimeReadinessForTests();
    mockWaitForStoreHydration.mockResolvedValue(undefined);
    mockWaitForPersistedAgentRecoveryReadiness.mockResolvedValue(undefined);
    mockReconcileStrandedAttempts.mockReturnValue([]);
    mockFlushSchedulerStorePersistenceNow.mockResolvedValue(undefined);
  });

  it('waits for scheduler, settings, and recovered chat state before reconciliation', async () => {
    let releaseHydration!: () => void;
    mockWaitForStoreHydration.mockImplementationOnce(
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
    expect(mockWaitForStoreHydration).toHaveBeenCalledTimes(2);
    expect(mockWaitForPersistedAgentRecoveryReadiness).toHaveBeenCalledTimes(1);
    expect(mockReconcileStrandedAttempts).toHaveBeenCalledTimes(1);
  });

  it('persists stranded-attempt reconciliation before becoming ready', async () => {
    mockReconcileStrandedAttempts.mockReturnValue([{ id: 'job-1' }]);

    await ensureSchedulerRuntimeReady();

    expect(mockFlushSchedulerStorePersistenceNow).toHaveBeenCalledTimes(1);
  });

  it('allows a later readiness attempt after a failed recovery', async () => {
    mockWaitForPersistedAgentRecoveryReadiness.mockRejectedValueOnce(new Error('recovery failed'));

    await expect(ensureSchedulerRuntimeReady()).rejects.toThrow('recovery failed');
    await expect(ensureSchedulerRuntimeReady()).resolves.toBeUndefined();
    expect(mockWaitForPersistedAgentRecoveryReadiness).toHaveBeenCalledTimes(2);
  });
});
