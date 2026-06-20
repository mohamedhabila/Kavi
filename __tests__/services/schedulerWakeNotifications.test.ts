import {
  cancelLocalNotification,
  sendLocalNotification,
} from '../../src/services/notifications/service';
import { useSchedulerStore } from '../../src/services/scheduler/store';
import { syncSchedulerWakeNotifications } from '../../src/services/scheduler/wakeNotifications';

jest.mock('../../src/services/notifications/service', () => ({
  sendLocalNotification: jest.fn().mockResolvedValue({ id: 'wake-notification', scheduled: true }),
  cancelLocalNotification: jest.fn().mockResolvedValue({ id: 'old-wake', cancelled: true }),
}));

const mockSendLocalNotification = sendLocalNotification as jest.Mock;
const mockCancelLocalNotification = cancelLocalNotification as jest.Mock;

function setJobRuntime(id: string, updates: Record<string, unknown>) {
  useSchedulerStore.setState({
    jobs: useSchedulerStore
      .getState()
      .jobs.map((job) => (job.id === id ? { ...job, ...updates } : job)),
  });
}

describe('scheduler wake notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSchedulerStore.setState({ jobs: [], lastEvaluationAtMs: undefined });
    mockSendLocalNotification.mockResolvedValue({ id: 'wake-notification', scheduled: true });
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

    expect(mockSendLocalNotification).toHaveBeenCalledWith({
      title: 'Wake me',
      body: 'Tap to wake the app and run this scheduled task.',
      delaySeconds: 60,
      data: {
        screen: 'Scheduler',
        jobId,
        source: 'scheduled_task_wake',
      },
    });
    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      pendingWakeNotificationId: 'wake-notification',
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
});
