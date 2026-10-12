import { sendLocalNotification } from '../../../../services/notifications/service';
import {
  completedToolOutcome,
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
