import {
  cancelLocalNotification,
  sendLocalNotification,
} from '../../../../services/notifications/service';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../../types/toolRuntimeOutcome';

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

export async function executeNotificationSchedule(args: {
  title: string;
  body: string;
  delaySeconds: number;
}): Promise<ToolRuntimeOutcome> {
  const result = await sendLocalNotification({
    title: args.title,
    body: args.body,
    delaySeconds: args.delaySeconds,
  });
  return completedToolOutcome(
    JSON.stringify({
      status: 'notification_scheduled',
      id: result.id,
      title: args.title,
      body: args.body,
      delaySeconds: Math.max(0, Math.floor(args.delaySeconds || 0)),
    }),
  );
}

export async function executeNotificationCancel(args: { id: string }): Promise<ToolRuntimeOutcome> {
  if (!args.id || typeof args.id !== 'string') {
    return failedToolOutcome(JSON.stringify({ error: 'Notification cancel requires an id.' }));
  }
  const result = await cancelLocalNotification(args.id);
  const content = JSON.stringify({
    status: 'notification_cancelled',
    id: result.id,
    cancelled: result.cancelled,
  });
  return result.cancelled ? completedToolOutcome(content) : failedToolOutcome(content);
}
