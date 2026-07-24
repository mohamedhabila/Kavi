import { getSchedulerNotificationTarget } from '../../src/navigation/notificationNavigation';

describe('notification navigation', () => {
  it('preserves the exact automation target', () => {
    expect(
      getSchedulerNotificationTarget({
        screen: 'Scheduler',
        source: 'scheduled_task',
        jobId: 'job-42',
      }),
    ).toEqual({ jobId: 'job-42' });
  });

  it('opens the generic automation list when no job is identified', () => {
    expect(getSchedulerNotificationTarget({ screen: 'Scheduler' })).toEqual({});
  });

  it('recognizes legacy wake routes without an explicit screen', () => {
    expect(
      getSchedulerNotificationTarget({ source: 'scheduled_task_wake', jobId: 'job-wake' }),
    ).toEqual({ jobId: 'job-wake' });
  });

  it('does not redirect conversation notifications', () => {
    expect(getSchedulerNotificationTarget({ screen: 'Chat', conversationId: 'conv-1' })).toBeNull();
  });
});
