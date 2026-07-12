const mockFlushSchedulerStorePersistenceNow = jest.fn().mockResolvedValue(undefined);
const mockEnsureSchedulerMaintenanceReady = jest.fn().mockResolvedValue(undefined);
const mockEnsureSchedulerRuntimeReady = jest.fn().mockResolvedValue(undefined);
const mockSyncSchedulerWakeNotifications = jest.fn().mockResolvedValue({ warnings: [] });
const mockCancelSchedulerJobWake = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/scheduler/persistence', () => ({
  ...jest.requireActual('../../src/services/scheduler/persistence'),
  flushSchedulerStorePersistenceNow: (...args: any[]) =>
    mockFlushSchedulerStorePersistenceNow(...args),
}));
jest.mock('../../src/services/scheduler/runtimeReadiness', () => ({
  ensureSchedulerMaintenanceReady: (...args: any[]) => mockEnsureSchedulerMaintenanceReady(...args),
  ensureSchedulerRuntimeReady: (...args: any[]) => mockEnsureSchedulerRuntimeReady(...args),
}));
jest.mock('../../src/services/scheduler/wakeNotifications', () => ({
  syncSchedulerWakeNotifications: (...args: any[]) => mockSyncSchedulerWakeNotifications(...args),
  cancelSchedulerJobWake: (...args: any[]) => mockCancelSchedulerJobWake(...args),
}));
jest.mock('../../src/services/cron/schedule', () => ({
  computeNextRunAtMs: jest.fn((schedule: any, nowMs: number) => {
    if (schedule.expr === 'invalid') throw new Error('invalid cron expression');
    return nowMs + 60_000;
  }),
}));

import {
  createScheduledJob,
  deleteScheduledJob,
  setScheduledJobEnabled,
} from '../../src/services/scheduler/commands';
import { resetSchedulerOperationLockForTests } from '../../src/services/scheduler/operationLock';
import { resetSchedulerStatePersistenceRecoveryForTests } from '../../src/services/scheduler/statePersistenceRecovery';
import { useSchedulerStore } from '../../src/services/scheduler/store';

describe('durable scheduler commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSchedulerOperationLockForTests();
    resetSchedulerStatePersistenceRecoveryForTests();
    useSchedulerStore.setState({ jobs: [], terminalReports: [] });
    mockFlushSchedulerStorePersistenceNow.mockResolvedValue(undefined);
    mockEnsureSchedulerMaintenanceReady.mockResolvedValue(undefined);
    mockEnsureSchedulerRuntimeReady.mockResolvedValue(undefined);
    mockSyncSchedulerWakeNotifications.mockResolvedValue({ warnings: [] });
    mockCancelSchedulerJobWake.mockResolvedValue(undefined);
  });

  afterEach(() => jest.useRealTimers());

  it('does not acknowledge creation until the scheduler write is durable', async () => {
    let releasePersistence!: () => void;
    mockFlushSchedulerStorePersistenceNow.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releasePersistence = resolve;
        }),
    );
    let settled = false;
    const creation = createScheduledJob({
      name: 'Durable job',
      prompt: 'Run durably',
      schedule: { kind: 'every', everyMs: 60_000 },
    }).then((result) => {
      settled = true;
      return result;
    });

    for (let index = 0; index < 5 && !releasePersistence; index += 1) {
      await Promise.resolve();
    }
    expect(settled).toBe(false);
    releasePersistence();

    await expect(creation).resolves.toEqual({ id: expect.any(String) });
    expect(mockSyncSchedulerWakeNotifications).toHaveBeenCalledWith({ force: true });
  });

  it('removes an uncommitted create instead of leaving executable in-memory work', async () => {
    mockFlushSchedulerStorePersistenceNow
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(
      createScheduledJob({
        name: 'Lost job',
        prompt: 'Must not run',
        schedule: { kind: 'every', everyMs: 60_000 },
      }),
    ).rejects.toThrow('Could not durably create');

    expect(useSchedulerStore.getState().jobs).toEqual([]);
    expect(mockSyncSchedulerWakeNotifications).not.toHaveBeenCalled();
  });

  it('reports wake degradation without denying a committed creation', async () => {
    mockSyncSchedulerWakeNotifications.mockRejectedValueOnce(new Error('OS unavailable'));

    await expect(
      createScheduledJob({
        name: 'Committed job',
        prompt: 'Run once durable',
        schedule: { kind: 'every', everyMs: 60_000 },
      }),
    ).resolves.toMatchObject({
      id: expect.any(String),
      warning: expect.stringContaining('OS unavailable'),
    });
    expect(useSchedulerStore.getState().jobs).toHaveLength(1);
  });

  it('rejects invalid schedules before mutating durable state', async () => {
    await expect(
      createScheduledJob({
        name: 'Invalid job',
        prompt: 'Never add me',
        schedule: { kind: 'cron', expr: 'invalid' },
      }),
    ).rejects.toThrow('Invalid scheduled job schedule');

    expect(useSchedulerStore.getState().jobs).toEqual([]);
    expect(mockFlushSchedulerStorePersistenceNow).not.toHaveBeenCalled();
  });

  it('reports unknown enable and disable targets instead of false success', async () => {
    await expect(setScheduledJobEnabled('missing', true)).resolves.toEqual({
      status: 'not_found',
    });
    await expect(setScheduledJobEnabled('missing', false)).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('keeps disable control available when full chat recovery is degraded', async () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'User-controlled safety',
      prompt: 'Remain controllable',
      schedule: { kind: 'every', everyMs: 60_000 },
    });
    mockEnsureSchedulerRuntimeReady.mockRejectedValue(new Error('chat recovery failed'));

    await expect(setScheduledJobEnabled(id, false)).resolves.toMatchObject({ status: 'updated' });

    expect(mockEnsureSchedulerMaintenanceReady).toHaveBeenCalled();
    expect(mockEnsureSchedulerRuntimeReady).not.toHaveBeenCalled();
    expect(useSchedulerStore.getState().getJob(id)?.enabled).toBe(false);
  });

  it('keeps a job disabled when its disable write cannot be confirmed', async () => {
    jest.useFakeTimers();
    const id = useSchedulerStore.getState().addJob({
      name: 'Safety first',
      prompt: 'Do not resurrect',
      schedule: { kind: 'every', everyMs: 60_000 },
    });
    mockFlushSchedulerStorePersistenceNow
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockRejectedValueOnce(new Error('disk still unavailable'))
      .mockResolvedValue(undefined);

    await expect(setScheduledJobEnabled(id, false)).rejects.toThrow('Could not durably disable');

    expect(useSchedulerStore.getState().getJob(id)?.enabled).toBe(false);
    expect(mockCancelSchedulerJobWake).toHaveBeenCalledWith(expect.objectContaining({ id }));
    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockFlushSchedulerStorePersistenceNow).toHaveBeenCalledTimes(3);
  });

  it('acknowledges a disable only after a fresh snapshot confirms it', async () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Retry disable',
      prompt: 'Confirm the safe state',
      schedule: { kind: 'every', everyMs: 60_000 },
    });
    mockFlushSchedulerStorePersistenceNow
      .mockRejectedValueOnce(new Error('first write failed'))
      .mockResolvedValueOnce(undefined);

    await expect(setScheduledJobEnabled(id, false)).resolves.toMatchObject({
      status: 'updated',
      warning: expect.stringContaining('durably confirmed'),
    });
    expect(useSchedulerStore.getState().getJob(id)?.enabled).toBe(false);
    expect(mockFlushSchedulerStorePersistenceNow).toHaveBeenCalledTimes(2);
  });

  it('reports wake maintenance degradation without denying a committed disable', async () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Committed disable',
      prompt: 'Disable me',
      schedule: { kind: 'every', everyMs: 60_000 },
    });
    mockSyncSchedulerWakeNotifications.mockRejectedValueOnce(new Error('OS unavailable'));

    await expect(setScheduledJobEnabled(id, false)).resolves.toEqual({
      status: 'updated',
      warning: expect.stringContaining('OS unavailable'),
    });
    expect(useSchedulerStore.getState().getJob(id)?.enabled).toBe(false);
  });

  it('disables and cancels the exact wake before durably deleting a job', async () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Delete safely',
      prompt: 'Remove me',
      schedule: { kind: 'every', everyMs: 60_000 },
    });
    useSchedulerStore.getState().updateJobRuntimeState(id, {
      pendingWakeNotificationId: 'wake-1',
      pendingWakeNotificationRunAtMs: Date.now() + 60_000,
    });
    mockCancelSchedulerJobWake.mockImplementationOnce(async () => {
      expect(useSchedulerStore.getState().getJob(id)?.enabled).toBe(false);
      expect(useSchedulerStore.getState().getJob(id)).toBeDefined();
    });

    await expect(deleteScheduledJob(id)).resolves.toBe('deleted');

    expect(mockCancelSchedulerJobWake).toHaveBeenCalledWith(
      expect.objectContaining({ id, pendingWakeNotificationId: 'wake-1' }),
    );
    expect(useSchedulerStore.getState().getJob(id)).toBeUndefined();
  });

  it('retains a disabled job when its wake notification cannot be cancelled', async () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Pending wake',
      prompt: 'Keep track of me',
      schedule: { kind: 'every', everyMs: 60_000 },
    });
    useSchedulerStore.getState().updateJobRuntimeState(id, {
      pendingWakeNotificationId: 'wake-2',
    });
    mockCancelSchedulerJobWake.mockRejectedValueOnce(new Error('OS cancellation failed'));

    await expect(deleteScheduledJob(id)).rejects.toThrow(
      'could not be deleted until its wake notification is cancelled',
    );

    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      enabled: false,
      pendingWakeNotificationId: 'wake-2',
    });
  });

  it('restores the post-cancellation snapshot when final delete persistence fails', async () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Rollback delete',
      prompt: 'Keep the safe snapshot',
      schedule: { kind: 'every', everyMs: 60_000 },
    });
    useSchedulerStore.getState().updateJobRuntimeState(id, {
      pendingWakeNotificationId: 'wake-cancelled',
      pendingWakeNotificationRunAtMs: Date.now() + 60_000,
    });
    mockCancelSchedulerJobWake.mockImplementationOnce(async () => {
      useSchedulerStore.getState().updateJobRuntimeState(id, {
        pendingWakeNotificationId: undefined,
        pendingWakeNotificationRunAtMs: undefined,
        pendingWakeNotificationTitle: undefined,
      });
    });
    mockFlushSchedulerStorePersistenceNow
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('delete fence failed'))
      .mockResolvedValue(undefined);

    await expect(deleteScheduledJob(id)).rejects.toThrow('Could not durably delete');

    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      enabled: false,
      pendingWakeNotificationId: undefined,
      pendingWakeNotificationRunAtMs: undefined,
    });
  });
});
