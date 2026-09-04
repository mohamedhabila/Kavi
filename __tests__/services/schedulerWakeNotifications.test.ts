import {
  cancelLocalNotification,
  listScheduledLocalNotifications,
  sendLocalNotification,
} from '../../src/services/notifications/service';
import { NotificationPermissionDeniedError } from '../../src/services/notifications/errors';
import { useSchedulerStore } from '../../src/services/scheduler/store';
import {
  consumeSchedulerJobWake,
  resetSchedulerWakeOperationsForTests,
  syncSchedulerWakeNotifications,
} from '../../src/services/scheduler/wakeNotifications';

jest.mock('../../src/services/notifications/service', () => ({
  sendLocalNotification: jest.fn(),
  cancelLocalNotification: jest.fn().mockResolvedValue({ id: 'old-wake', cancelled: true }),
  listScheduledLocalNotifications: jest.fn().mockResolvedValue([]),
}));

const mockSendLocalNotification = sendLocalNotification as jest.Mock;
const mockCancelLocalNotification = cancelLocalNotification as jest.Mock;
const mockListScheduledLocalNotifications = listScheduledLocalNotifications as jest.Mock;

function setJobRuntime(id: string, updates: Record<string, unknown>) {
  useSchedulerStore.setState({
    jobs: useSchedulerStore
      .getState()
      .jobs.map((job) => (job.id === id ? { ...job, ...updates } : job)),
  });
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition did not become ready');
}

describe('scheduler wake notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSchedulerWakeOperationsForTests();
    useSchedulerStore.setState({ jobs: [], terminalReports: [] });
    mockListScheduledLocalNotifications.mockResolvedValue([]);
    mockSendLocalNotification.mockImplementation(
      async ({ identifier }: { identifier: string }) => ({
        id: identifier,
        scheduled: true,
      }),
    );
  });

  it('schedules a wake notification for the next enabled job run when forced', async () => {
    const now = 1_700_001_000_000;
    const runAtMs = now + 60_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Wake me',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'wake',
    });
    setJobRuntime(jobId, { nextRunAtMs: runAtMs });

    await syncSchedulerWakeNotifications({ nowMs: now, force: true });

    expect(mockSendLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: expect.stringMatching(/^scheduler-wake-[a-f0-9]{32}$/u),
        title: 'Wake me',
        body: 'Tap to wake the app and run this scheduled task.',
        delaySeconds: 60,
        data: {
          screen: 'Scheduler',
          jobId,
          source: 'scheduled_task_wake',
        },
      }),
    );
    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      pendingWakeNotificationId: expect.stringMatching(/^scheduler-wake-/u),
      pendingWakeNotificationRunAtMs: runAtMs,
      lastWakeAtMs: now,
      lastWakeSource: 'scheduled',
    });
  });

  it('does not schedule missing wake notifications during maintenance sync unless forced', async () => {
    const now = 1_700_001_100_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Passive',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'passive',
    });
    setJobRuntime(jobId, { nextRunAtMs: now + 60_000 });

    await syncSchedulerWakeNotifications({ nowMs: now });

    expect(mockSendLocalNotification).not.toHaveBeenCalled();
  });

  it('adopts a deterministic OS wake left by a crash before scheduler state persisted', async () => {
    const now = 1_700_001_150_000;
    const runAtMs = now + 60_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Crash-safe wake',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'recover the wake',
    });
    setJobRuntime(jobId, { nextRunAtMs: runAtMs });

    await syncSchedulerWakeNotifications({ nowMs: now, force: true });
    const wakeId = useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationId;
    expect(wakeId).toMatch(/^scheduler-wake-/u);
    if (!wakeId) throw new Error('expected a persisted wake identifier');

    setJobRuntime(jobId, {
      pendingWakeNotificationId: undefined,
      pendingWakeNotificationRunAtMs: undefined,
      pendingWakeNotificationTitle: undefined,
    });
    mockSendLocalNotification.mockClear();
    mockListScheduledLocalNotifications.mockResolvedValue([
      { id: wakeId, data: { source: 'scheduled_task_wake', jobId } },
    ]);

    await syncSchedulerWakeNotifications({ nowMs: now, force: true });

    expect(mockSendLocalNotification).not.toHaveBeenCalled();
    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      pendingWakeNotificationId: wakeId,
      pendingWakeNotificationRunAtMs: runAtMs,
      pendingWakeNotificationTitle: 'Crash-safe wake',
    });
  });

  it('recreates a persisted wake whose OS request disappeared before state was cleared', async () => {
    const now = 1_700_001_175_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Repair missing wake',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'repair it',
    });
    setJobRuntime(jobId, { nextRunAtMs: now + 60_000 });
    await syncSchedulerWakeNotifications({ nowMs: now, force: true });
    const wakeId = useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationId;
    mockSendLocalNotification.mockClear();
    mockCancelLocalNotification.mockClear();
    mockListScheduledLocalNotifications.mockResolvedValue([]);

    await syncSchedulerWakeNotifications({ nowMs: now, force: true });

    expect(mockCancelLocalNotification).toHaveBeenCalledWith(wakeId);
    expect(mockSendLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: wakeId }),
    );
    expect(useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationId).toBe(wakeId);
  });

  it('removes an orphaned scheduler wake for a deleted job', async () => {
    mockListScheduledLocalNotifications.mockResolvedValue([
      {
        id: 'scheduler-wake-orphan',
        data: { source: 'scheduled_task_wake', jobId: 'deleted-job' },
      },
    ]);

    await syncSchedulerWakeNotifications({ nowMs: 1_700_001_190_000, force: true });

    expect(mockCancelLocalNotification).toHaveBeenCalledWith('scheduler-wake-orphan');
  });

  it('cancels stale wake notifications for disabled jobs', async () => {
    const now = 1_700_001_200_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Disabled',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'disabled',
    });
    setJobRuntime(jobId, {
      enabled: false,
      nextRunAtMs: now + 60_000,
      pendingWakeNotificationId: 'old-wake',
      pendingWakeNotificationRunAtMs: now + 60_000,
    });

    await syncSchedulerWakeNotifications({ nowMs: now });

    expect(mockCancelLocalNotification).toHaveBeenCalledWith('old-wake');
    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      pendingWakeNotificationId: undefined,
      pendingWakeNotificationRunAtMs: undefined,
    });
  });

  it('reschedules a pending wake notification when the next run changes', async () => {
    const now = 1_700_001_300_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Reschedule',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'reschedule',
    });
    setJobRuntime(jobId, {
      nextRunAtMs: now + 120_000,
      pendingWakeNotificationId: 'old-wake',
      pendingWakeNotificationRunAtMs: now + 60_000,
    });

    await syncSchedulerWakeNotifications({ nowMs: now });

    expect(mockCancelLocalNotification).toHaveBeenCalledWith('old-wake');
    expect(mockSendLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        delaySeconds: 120,
        data: expect.objectContaining({ jobId }),
      }),
    );
    expect(useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationRunAtMs).toBe(
      now + 120_000,
    );
  });

  it('retains a wake identifier when OS cancellation fails', async () => {
    const now = 1_700_001_400_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Track cancellation',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'disabled',
    });
    setJobRuntime(jobId, {
      enabled: false,
      pendingWakeNotificationId: 'uncancelled-wake',
      pendingWakeNotificationRunAtMs: now + 60_000,
    });
    mockCancelLocalNotification.mockRejectedValueOnce(new Error('OS cancellation failed'));

    await expect(syncSchedulerWakeNotifications({ nowMs: now })).resolves.toEqual({
      warnings: [expect.stringContaining('OS cancellation failed')],
    });

    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      pendingWakeNotificationId: 'uncancelled-wake',
      lastWakeError: expect.stringContaining('OS cancellation failed'),
      lastWakeFailureAtMs: now,
    });
  });

  it('serializes concurrent wake synchronization to avoid orphan notifications', async () => {
    const now = 1_700_001_500_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Single wake',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'once',
    });
    setJobRuntime(jobId, { nextRunAtMs: now + 60_000 });
    let releaseNotification!: () => void;
    let scheduledId = '';
    mockListScheduledLocalNotifications.mockImplementation(async () =>
      scheduledId ? [{ id: scheduledId, data: { source: 'scheduled_task_wake', jobId } }] : [],
    );
    mockSendLocalNotification.mockImplementationOnce(
      ({ identifier }: { identifier: string }) =>
        new Promise((resolve) => {
          scheduledId = identifier;
          releaseNotification = () => resolve({ id: identifier, scheduled: true });
        }),
    );

    const first = syncSchedulerWakeNotifications({ nowMs: now, force: true });
    const second = syncSchedulerWakeNotifications({ nowMs: now, force: true });
    await waitForCondition(() => typeof releaseNotification === 'function');
    releaseNotification();
    await Promise.all([first, second]);

    expect(mockSendLocalNotification).toHaveBeenCalledTimes(1);
    expect(useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationId).toBe(scheduledId);
  });

  it('replaces a wake created concurrently with a job rename', async () => {
    const now = 1_700_001_550_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Old title',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'rename safely',
    });
    setJobRuntime(jobId, { nextRunAtMs: now + 60_000 });
    let releaseFirstWake!: () => void;
    let firstWakeId = '';
    mockSendLocalNotification
      .mockImplementationOnce(
        ({ identifier }: { identifier: string }) =>
          new Promise((resolve) => {
            firstWakeId = identifier;
            releaseFirstWake = () => resolve({ id: identifier, scheduled: true });
          }),
      )
      .mockImplementationOnce(async ({ identifier }: { identifier: string }) => ({
        id: identifier,
        scheduled: true,
      }));

    const first = syncSchedulerWakeNotifications({ nowMs: now, force: true });
    await waitForCondition(() => typeof releaseFirstWake === 'function');
    useSchedulerStore.getState().updateJob(jobId, { name: 'New title' });
    const second = syncSchedulerWakeNotifications({ nowMs: now, force: true });
    releaseFirstWake();
    await Promise.all([first, second]);

    expect(mockCancelLocalNotification).toHaveBeenCalledWith(firstWakeId);
    expect(mockSendLocalNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'New title' }),
    );
    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      pendingWakeNotificationId: expect.stringMatching(/^scheduler-wake-/u),
      pendingWakeNotificationTitle: 'New title',
    });
  });

  it('cancels a newly-created wake if the job is disabled while scheduling', async () => {
    const now = 1_700_001_600_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Disable race',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'stop',
    });
    setJobRuntime(jobId, { nextRunAtMs: now + 60_000 });
    let releaseNotification!: () => void;
    let racingWakeId = '';
    mockSendLocalNotification.mockImplementationOnce(
      ({ identifier }: { identifier: string }) =>
        new Promise((resolve) => {
          racingWakeId = identifier;
          releaseNotification = () => resolve({ id: identifier, scheduled: true });
        }),
    );

    const sync = syncSchedulerWakeNotifications({ nowMs: now, force: true });
    await waitForCondition(() => typeof releaseNotification === 'function');
    useSchedulerStore.getState().disableJob(jobId);
    releaseNotification();
    await sync;

    expect(mockCancelLocalNotification).toHaveBeenCalledWith(racingWakeId);
    expect(useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationId).toBeUndefined();
  });

  it('rearms a due wake whose stored OS request has already fired', async () => {
    const now = 1_700_001_700_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Due wake',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'wait for foreground',
    });
    setJobRuntime(jobId, {
      nextRunAtMs: now - 1,
      pendingWakeNotificationId: 'due-wake',
      pendingWakeNotificationRunAtMs: now - 1,
    });

    await syncSchedulerWakeNotifications({ nowMs: now, force: true, preserveDueWake: true });

    expect(mockCancelLocalNotification).toHaveBeenCalledWith('due-wake');
    expect(mockSendLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({ delaySeconds: 1, data: expect.objectContaining({ jobId }) }),
    );
    expect(useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationId).toMatch(
      /^scheduler-wake-/u,
    );
  });

  it('consumes only the exact wake notification that was tapped', async () => {
    const now = 1_700_001_750_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Tapped wake',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'run after tap',
    });
    setJobRuntime(jobId, {
      pendingWakeNotificationId: 'current-wake',
      pendingWakeNotificationRunAtMs: now,
      pendingWakeNotificationTitle: 'Tapped wake',
    });

    await expect(consumeSchedulerJobWake(jobId, 'stale-wake')).resolves.toBe(false);
    await expect(consumeSchedulerJobWake(jobId, 'current-wake')).resolves.toBe(true);

    expect(useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationId).toBeUndefined();
    expect(mockCancelLocalNotification).toHaveBeenCalledWith('current-wake');
  });

  it('tracks a newly-created wake when race cleanup cancellation fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = 1_700_001_800_000;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Cleanup failure',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'stop safely',
    });
    setJobRuntime(jobId, { nextRunAtMs: now + 60_000 });
    let releaseNotification!: () => void;
    let trackedRaceWakeId = '';
    mockSendLocalNotification.mockImplementationOnce(
      ({ identifier }: { identifier: string }) =>
        new Promise((resolve) => {
          trackedRaceWakeId = identifier;
          releaseNotification = () => resolve({ id: identifier, scheduled: true });
        }),
    );
    mockCancelLocalNotification.mockRejectedValueOnce(new Error('cleanup cancellation failed'));

    const sync = syncSchedulerWakeNotifications({ nowMs: now, force: true });
    await waitForCondition(() => typeof releaseNotification === 'function');
    useSchedulerStore.getState().disableJob(jobId);
    releaseNotification();

    await expect(sync).resolves.toEqual({
      warnings: [expect.stringContaining('cleanup cancellation failed')],
    });
    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      pendingWakeNotificationId: trackedRaceWakeId,
      lastWakeError: expect.stringContaining('cleanup cancellation failed'),
    });
    warnSpy.mockRestore();
  });

  it('suppresses further wake scheduling after a structured notification-permission error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = 1_700_001_900_000;
    const firstJobId = useSchedulerStore.getState().addJob({
      name: 'Denied wake',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'wake me',
    });
    setJobRuntime(firstJobId, { nextRunAtMs: now + 60_000 });
    mockSendLocalNotification.mockRejectedValueOnce(new NotificationPermissionDeniedError());

    await syncSchedulerWakeNotifications({ nowMs: now, force: true });

    expect(useSchedulerStore.getState().getJob(firstJobId)).toMatchObject({
      lastWakeError: expect.stringContaining('Notification permission denied'),
    });
    mockSendLocalNotification.mockClear();

    // A second job scheduled moments later, still within the suppression
    // window, must not even attempt to call the notification service —
    // the structured permission error suppresses scheduling entirely.
    const secondJobId = useSchedulerStore.getState().addJob({
      name: 'Still denied',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'wake me too',
    });
    setJobRuntime(secondJobId, { nextRunAtMs: now + 120_000 });

    await syncSchedulerWakeNotifications({ nowMs: now + 1_000, force: true });

    expect(mockSendLocalNotification).not.toHaveBeenCalled();
    expect(useSchedulerStore.getState().getJob(secondJobId)).toMatchObject({
      lastWakeError: expect.stringContaining('temporarily suppressed'),
    });
    warnSpy.mockRestore();
  });
});
