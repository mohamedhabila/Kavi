import { readRecentNotifications } from '../../../../services/notifications/notificationReader';
import { sendLocalNotification } from '../../../../services/notifications/service';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../../types/toolRuntimeOutcome';
import { NOTIFICATIONS_READ_MAX_LIMIT, NOTIFICATIONS_READ_MAX_SINCE_MINUTES } from './definitions';

export async function executeNotificationSend(args: {
  title: string;
  body: string;
}): Promise<ToolRuntimeOutcome> {
  const result = await sendLocalNotification({
    title: args.title,
    body: args.body,
  });
  return completedToolOutcome(
    JSON.stringify({
      status: 'notification_accepted',
      id: result.id,
      title: args.title,
      body: args.body,
    }),
  );
}

const DEFAULT_SINCE_MINUTES = 24 * 60;
const DEFAULT_LIMIT = 30;

function boundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(1, Math.floor(value)))
    : fallback;
}

export async function executeNotificationsRead(
  args: Record<string, unknown> | undefined,
): Promise<ToolRuntimeOutcome> {
  const sinceMinutes = boundedInteger(
    args?.since_minutes,
    DEFAULT_SINCE_MINUTES,
    NOTIFICATIONS_READ_MAX_SINCE_MINUTES,
  );
  const limit = boundedInteger(args?.limit, DEFAULT_LIMIT, NOTIFICATIONS_READ_MAX_LIMIT);
  const since = Date.now() - sinceMinutes * 60_000;
  const { access, notifications } = await readRecentNotifications(since, limit);
  if (access === 'unavailable') {
    return failedToolOutcome(
      JSON.stringify({
        status: 'platform_unavailable',
        code: 'platform_unavailable',
        error: "This phone does not let apps read other apps' notifications.",
      }),
      'unavailable',
    );
  }
  if (access === 'not_granted') {
    return failedToolOutcome(
      JSON.stringify({
        status: 'permission_denied',
        code: 'permission_denied',
        error:
          'Notification access is off. The person can turn it on in Kavi Settings, Notifications & voice.',
      }),
      'permission',
    );
  }
  return completedToolOutcome(
    JSON.stringify({
      status: 'completed',
      since: new Date(since).toISOString(),
      count: notifications.length,
      notifications: notifications.map((notification) => ({
        app: notification.app,
        title: notification.title,
        text: notification.text,
        postedAt: new Date(notification.postedAt).toISOString(),
        showing: notification.showing,
      })),
    }),
  );
}
