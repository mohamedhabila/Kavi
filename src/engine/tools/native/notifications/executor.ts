import {
  readRecentNotifications,
  replyToNotification,
  type NotificationReplyStatus,
} from '../../../../services/notifications/notificationReader';
import type { ToolCallFailureKind } from '../../../../types/message';
import { sendLocalNotification } from '../../../../services/notifications/service';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../../types/toolRuntimeOutcome';
import {
  NOTIFICATIONS_READ_MAX_LIMIT,
  NOTIFICATIONS_READ_MAX_SINCE_MINUTES,
  NOTIFICATIONS_REPLY_MAX_MESSAGE_LENGTH,
} from './definitions';

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
        id: notification.id,
        app: notification.app,
        title: notification.title,
        text: notification.text,
        postedAt: new Date(notification.postedAt).toISOString(),
        showing: notification.showing,
        canReply: notification.canReply,
      })),
    }),
  );
}

const REPLY_FAILURES: Record<
  Exclude<NotificationReplyStatus, 'sent'>,
  Readonly<{ error: string; failureKind: ToolCallFailureKind }>
> = {
  not_showing: {
    error:
      "That notification no longer shows, and its app's reply went with it. Open the chat in " +
      'the app instead, or tell the person.',
    failureKind: 'not_found',
  },
  no_reply_action: {
    error: "This notification's app offers no reply from the notification.",
    failureKind: 'unavailable',
  },
  expired: {
    error: 'The app withdrew this reply; the conversation may have been opened already.',
    failureKind: 'not_found',
  },
  not_granted: {
    error:
      'Notification access is off. The person can turn it on in Kavi Settings, Notifications & voice.',
    failureKind: 'permission',
  },
  unavailable: {
    error: "This phone does not let apps reply to other apps' notifications.",
    failureKind: 'unavailable',
  },
};

export async function executeNotificationsReply(
  args: Record<string, unknown> | undefined,
): Promise<ToolRuntimeOutcome> {
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  const message = typeof args?.message === 'string' ? args.message.trim() : '';
  if (!id || !message || message.length > NOTIFICATIONS_REPLY_MAX_MESSAGE_LENGTH) {
    return failedToolOutcome(
      JSON.stringify({
        status: 'invalid_arguments',
        error: `notifications_reply needs a notification id and a message of 1 to ${NOTIFICATIONS_REPLY_MAX_MESSAGE_LENGTH} characters.`,
      }),
      'invalid_arguments',
    );
  }
  const result = await replyToNotification(id, message);
  const where = {
    ...(result.app ? { app: result.app } : {}),
    ...(result.title ? { conversation: result.title } : {}),
  };
  if (result.status === 'sent') {
    return completedToolOutcome(JSON.stringify({ status: 'sent', ...where, message }));
  }
  const failure = REPLY_FAILURES[result.status];
  return failedToolOutcome(
    JSON.stringify({ status: result.status, code: result.status, ...where, error: failure.error }),
    failure.failureKind,
  );
}
