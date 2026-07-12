import type { CronJob } from '../cron/types';
import { sendLocalNotification } from '../notifications/service';
import { resolveSchedulerExecutionConversationId } from './executionError';
import {
  shouldDeliverScheduledJobNotification,
  summarizeScheduledJobNotification,
} from './executionPresentation';
import type { SchedulerExecutionResult } from './executionResult';

export async function notifyScheduledJobSuccess(
  job: CronJob,
  result: SchedulerExecutionResult,
  notificationIdentifier?: string,
): Promise<void> {
  if (!shouldDeliverScheduledJobNotification(job)) return;
  await sendLocalNotification({
    identifier: notificationIdentifier,
    title: job.name || 'Scheduled Task',
    body: summarizeScheduledJobNotification(result.output),
    data:
      result.conversationId && result.conversationDurable !== false
        ? {
            screen: 'Chat',
            conversationId: result.conversationId,
            source: 'scheduled_task',
          }
        : job.id
          ? {
              screen: 'Scheduler',
              jobId: job.id,
              source: 'scheduled_task',
            }
          : undefined,
  });
}

export async function notifyScheduledJobFinalFailure(
  job: CronJob,
  error: unknown,
  notificationIdentifier?: string,
): Promise<void> {
  if (job.failureAlert?.enabled === false || !shouldDeliverScheduledJobNotification(job)) return;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const conversationId = resolveSchedulerExecutionConversationId(error);
  await sendLocalNotification({
    identifier: notificationIdentifier,
    title: job.name || 'Scheduled Task Failed',
    body: summarizeScheduledJobNotification(`Error: ${errorMessage}`),
    data: conversationId
      ? {
          screen: 'Chat',
          conversationId,
          source: 'scheduled_task',
        }
      : job.id
        ? {
            screen: 'Scheduler',
            jobId: job.id,
            source: 'scheduled_task',
          }
        : undefined,
  });
}
