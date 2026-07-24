import type { NotificationRouteData } from '../services/notifications/service';

export type SchedulerNotificationTarget = {
  jobId?: string;
};

export function getSchedulerNotificationTarget(
  route: NotificationRouteData,
): SchedulerNotificationTarget | null {
  if (route.screen !== 'Scheduler' && route.source !== 'scheduled_task_wake') return null;
  return route.jobId ? { jobId: route.jobId } : {};
}
