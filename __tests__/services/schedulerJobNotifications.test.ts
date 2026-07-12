const mockSendLocalNotification = jest.fn().mockResolvedValue({ id: 'notification-1' });

jest.mock('../../src/services/notifications/service', () => ({
  sendLocalNotification: (...args: any[]) => mockSendLocalNotification(...args),
}));

import { SchedulerExecutionError } from '../../src/services/scheduler/executionError';
import {
  notifyScheduledJobFinalFailure,
  notifyScheduledJobSuccess,
} from '../../src/services/scheduler/jobNotifications';

const job = {
  id: 'job-1',
  name: 'Durability routing',
  delivery: { mode: 'notification' as const },
  failureAlert: { enabled: true },
} as any;

describe('scheduled job notification routing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes a non-durable successful conversation to Scheduler', async () => {
    await notifyScheduledJobSuccess(job, {
      output: 'Completed with a local persistence warning.',
      conversationId: 'conversation-1',
      conversationDurable: false,
    });

    expect(mockSendLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          screen: 'Scheduler',
          jobId: 'job-1',
          source: 'scheduled_task',
        },
      }),
    );
  });

  it('routes a non-durable failed conversation to Scheduler', async () => {
    const error = new SchedulerExecutionError(
      new Error('provider failed'),
      'conversation-1',
      ['conversation persistence failed'],
      false,
    );

    await notifyScheduledJobFinalFailure(job, error);

    expect(mockSendLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          screen: 'Scheduler',
          jobId: 'job-1',
          source: 'scheduled_task',
        },
      }),
    );
  });
});
