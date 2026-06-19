import {
  cancelLocalNotification,
  sendLocalNotification,
} from '../../../../services/notifications/service';

export async function executeNotificationSend(args: {
  title: string;
  body: string;
}): Promise<string> {
  const result = await sendLocalNotification({
    title: args.title,
    body: args.body,
  });
  return JSON.stringify({
    status: 'notification_displayed',
    id: result.id,
    title: args.title,
    body: args.body,
  });
}

export async function executeNotificationSchedule(args: {
  title: string;
  body: string;
  delaySeconds: number;
}): Promise<string> {
  const result = await sendLocalNotification({
    title: args.title,
    body: args.body,
    delaySeconds: args.delaySeconds,
  });
  return JSON.stringify({
    status: 'notification_scheduled',
    id: result.id,
    title: args.title,
    body: args.body,
    delaySeconds: Math.max(0, Math.floor(args.delaySeconds || 0)),
  });
}

export async function executeNotificationCancel(args: { id: string }): Promise<string> {
  if (!args.id || typeof args.id !== 'string') {
    return JSON.stringify({ error: 'Notification cancel requires an id.' });
  }
  const result = await cancelLocalNotification(args.id);
  return JSON.stringify({
    status: 'notification_cancelled',
    id: result.id,
    cancelled: result.cancelled,
  });
}
