import * as Notifications from 'expo-notifications';

let notificationHandlerConfigured = false;
const DEFAULT_CHANNEL_ID = 'kavi-default';

export interface NotificationRouteData extends Record<string, unknown> {
  screen?: 'Chat' | 'Scheduler';
  conversationId?: string;
  jobId?: string;
  source?: 'scheduled_task' | 'scheduled_task_wake';
}

let lastHandledNotificationKey: string | null = null;

function ensureNotificationHandlerConfigured(): void {
  if (notificationHandlerConfigured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  notificationHandlerConfigured = true;
}

async function ensurePermissions(): Promise<void> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return;

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  if (!requested.granted) {
    throw new Error('Notification permission denied');
  }
}

async function ensureChannelConfigured(): Promise<void> {
  if (process.env.JEST_WORKER_ID) return;
  await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
    name: 'Kavi',
    description: 'Task results, reminders, and agent alerts',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export async function initializeNotifications(): Promise<void> {
  ensureNotificationHandlerConfigured();
  await ensureChannelConfigured();
}

function buildNotificationKey(response: Notifications.NotificationResponse): string {
  return `${response.notification.request.identifier}:${response.actionIdentifier}`;
}

function extractNotificationRouteData(
  response: Notifications.NotificationResponse | null,
): NotificationRouteData | null {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return null;
  }

  const contentData = response.notification.request.content.data;
  if (!contentData || typeof contentData !== 'object') {
    return null;
  }

  const route = contentData as NotificationRouteData;
  if (!route.conversationId && !route.jobId) {
    return null;
  }

  return {
    screen: route.screen || (route.jobId ? 'Scheduler' : 'Chat'),
    conversationId: route.conversationId,
    jobId: route.jobId,
    source: route.source,
  };
}

function markHandled(response: Notifications.NotificationResponse): boolean {
  const key = buildNotificationKey(response);
  if (key === lastHandledNotificationKey) {
    return false;
  }

  lastHandledNotificationKey = key;
  return true;
}

export function subscribeToNotificationRoutes(
  listener: (route: NotificationRouteData) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = extractNotificationRouteData(response);
    if (!route || !markHandled(response)) {
      return;
    }
    listener(route);
  });

  return () => {
    subscription.remove();
  };
}

export async function getPendingNotificationRoute(): Promise<NotificationRouteData | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  const route = extractNotificationRouteData(response);
  if (!response || !route || !markHandled(response)) {
    return null;
  }

  if (Notifications.clearLastNotificationResponseAsync) {
    await Notifications.clearLastNotificationResponseAsync().catch((e) =>
      console.warn('[Notifications] clearLastNotificationResponseAsync failed:', e),
    );
  }

  return route;
}

export async function sendLocalNotification(args: {
  title: string;
  body: string;
  delaySeconds?: number;
  data?: NotificationRouteData;
}): Promise<{ id: string; scheduled: boolean }> {
  ensureNotificationHandlerConfigured();
  await ensurePermissions();
  await ensureChannelConfigured();

  const seconds = Math.max(0, Math.floor(args.delaySeconds || 0));
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: args.title,
      body: args.body,
      // Expo Android resolves the string form ('default') to a concrete Uri.
      // Scheduled notifications persist the request, and that Uri-backed path
      // can fail serialization on Android. The boolean form keeps default sound
      // semantics without constructing a Uri.
      sound: true,
      data: args.data,
    },
    trigger:
      seconds > 0
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds,
            channelId: DEFAULT_CHANNEL_ID,
          }
        : null,
  });

  return { id, scheduled: seconds > 0 };
}

export async function cancelLocalNotification(
  id: string,
): Promise<{ id: string; cancelled: true }> {
  await Notifications.cancelScheduledNotificationAsync(id);
  return { id, cancelled: true };
}
