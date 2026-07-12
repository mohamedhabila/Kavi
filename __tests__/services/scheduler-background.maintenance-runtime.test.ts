const mockSyncSchedulerWakeNotifications = jest.fn().mockResolvedValue({ warnings: [] });
const mockWaitForPersistedAgentRecoveryReadiness = jest.fn().mockResolvedValue(undefined);
const mockDefineTask = jest.fn((_: string, handler: () => Promise<number>) => {
  definedTaskHandler = handler;
});
let definedTaskHandler: (() => Promise<number>) | undefined;

jest.mock('../../src/services/scheduler/wakeNotifications', () => ({
  syncSchedulerWakeNotifications: (...args: unknown[]) =>
    mockSyncSchedulerWakeNotifications(...args),
}));

jest.mock('../../src/services/startupRecovery', () => ({
  waitForPersistedAgentRecoveryReadiness: (...args: unknown[]) =>
    mockWaitForPersistedAgentRecoveryReadiness(...args),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: unknown[]) => mockDefineTask(...args),
}));

jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: {
    Success: 1,
    Failed: 2,
  },
  registerTaskAsync: jest.fn().mockResolvedValue(undefined),
  unregisterTaskAsync: jest.fn().mockResolvedValue(undefined),
}));

require('../../src/services/scheduler/background');
const { setSchedulerExecutor } = require('../../src/services/scheduler/engine');
const { shouldRunScheduledJob } = require('../../src/services/scheduler/eligibility');
const { flushSchedulerStorePersistenceNow } = require('../../src/services/scheduler/persistence');
const {
  resetSchedulerRuntimeReadinessForTests,
} = require('../../src/services/scheduler/runtimeReadiness');
const { useSchedulerStore } = require('../../src/services/scheduler/store');
const { waitForStoreHydration } = require('../../src/store/persistHydration');

describe('Expo scheduler background maintenance runtime', () => {
  beforeEach(async () => {
    await waitForStoreHydration(useSchedulerStore, null);
    useSchedulerStore.setState({ jobs: [], terminalReports: [] });
    await flushSchedulerStorePersistenceNow();
    resetSchedulerRuntimeReadinessForTests();
    setSchedulerExecutor(null);
    mockSyncSchedulerWakeNotifications.mockClear();
    mockSyncSchedulerWakeNotifications.mockResolvedValue({ warnings: [] });
    mockWaitForPersistedAgentRecoveryReadiness.mockClear();
  });

  afterEach(() => {
    setSchedulerExecutor(null);
  });

  it('reconciles and syncs wakes without dispatching an eligible one-shot job', async () => {
    const nowMs = Date.now();
    const execute = jest.fn().mockResolvedValue({ output: 'must not run headlessly' });
    setSchedulerExecutor({ execute });
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Foreground-owned one shot',
      schedule: { kind: 'at', atMs: nowMs + 60_000 },
      prompt: 'Perform arbitrary agent work',
    });
    useSchedulerStore.setState({
      jobs: useSchedulerStore
        .getState()
        .jobs.map((job) => (job.id === jobId ? { ...job, nextRunAtMs: nowMs - 1 } : job)),
    });
    await flushSchedulerStorePersistenceNow();

    const before = useSchedulerStore.getState().getJob(jobId);
    expect(before && shouldRunScheduledJob(before, nowMs, false)).toBe(true);

    await expect(definedTaskHandler?.()).resolves.toBe(1);

    const after = useSchedulerStore.getState().getJob(jobId);
    expect(execute).not.toHaveBeenCalled();
    expect(after).toMatchObject({
      id: jobId,
      enabled: true,
      nextRunAtMs: nowMs - 1,
    });
    expect(after?.runningAttemptId).toBeUndefined();
    expect(after?.lastRunAtMs).toBeUndefined();
    expect(after && shouldRunScheduledJob(after, Date.now(), false)).toBe(true);
    expect(mockWaitForPersistedAgentRecoveryReadiness).toHaveBeenCalledTimes(1);
    expect(mockSyncSchedulerWakeNotifications).toHaveBeenCalledWith({
      nowMs: expect.any(Number),
      force: true,
      preserveDueWake: true,
    });
  });
});
