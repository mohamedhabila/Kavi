// Live E2E runs in Node, without Expo's native notification module. The live harness
// replaces `expo-notifications` with this module, so what the app schedules or cancels with
// the operating system — a reminder, a wake notification — lands in the native fixture
// state the scenario rubrics read, whichever tool asked for it.

import {
  recordE2ENotificationCancelled,
  recordE2ENotificationScheduled,
} from './e2eNativeMobileFixtures';

type NotificationRequest = Readonly<{
  identifier?: string;
  content?: unknown;
  trigger?: unknown;
}>;

const GRANTED_PERMISSION = Object.freeze({
  granted: true,
  status: 'granted',
  canAskAgain: true,
  expires: 'never',
});

/**
 * Seconds until a trigger fires, or null when the request is shown immediately (no trigger,
 * or only a channel). A calendar-style repeating trigger (daily, weekly) has no single delay
 * and counts as 0.
 */
function delaySecondsOf(trigger: unknown, nowMs: number): number | null {
  if (!trigger || typeof trigger !== 'object') return null;
  if (Object.keys(trigger).every((key) => key === 'channelId')) return null;
  const { seconds, date } = trigger as { seconds?: unknown; date?: unknown };
  if (typeof seconds === 'number') return Math.max(0, Math.floor(seconds));
  if (typeof date === 'number' || date instanceof Date) {
    return Math.max(0, Math.round((Number(date) - nowMs) / 1000));
  }
  return 0;
}

export function createE2ENotificationsModule() {
  const pending = new Map<string, NotificationRequest>();
  let issued = 0;

  return {
    setNotificationHandler: (): void => undefined,
    getPermissionsAsync: async () => GRANTED_PERMISSION,
    requestPermissionsAsync: async () => GRANTED_PERMISSION,
    setNotificationChannelAsync: async (): Promise<null> => null,
    scheduleNotificationAsync: async (request: NotificationRequest): Promise<string> => {
      issued += 1;
      const identifier = request.identifier ?? `e2e-notification-${issued}`;
      const delaySeconds = delaySecondsOf(request.trigger, Date.now());
      if (delaySeconds !== null) {
        pending.set(identifier, request);
        recordE2ENotificationScheduled(delaySeconds);
      }
      return identifier;
    },
    cancelScheduledNotificationAsync: async (identifier: string): Promise<void> => {
      if (pending.delete(identifier)) recordE2ENotificationCancelled();
    },
    getAllScheduledNotificationsAsync: async () =>
      [...pending.entries()].map(([identifier, request]) => ({
        identifier,
        content: request.content ?? {},
        trigger: request.trigger ?? null,
      })),
    addNotificationResponseReceivedListener: () => ({ remove: (): void => undefined }),
    getLastNotificationResponseAsync: async (): Promise<null> => null,
    clearLastNotificationResponseAsync: async (): Promise<void> => undefined,
    DEFAULT_ACTION_IDENTIFIER: 'expo.notifications.actions.DEFAULT',
    PermissionStatus: { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' },
    IosAuthorizationStatus: {
      NOT_DETERMINED: 0,
      DENIED: 1,
      AUTHORIZED: 2,
      PROVISIONAL: 3,
      EPHEMERAL: 4,
    },
    AndroidImportance: { DEFAULT: 5, HIGH: 6 },
    AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 2 },
    SchedulableTriggerInputTypes: {
      CALENDAR: 'calendar',
      DAILY: 'daily',
      WEEKLY: 'weekly',
      MONTHLY: 'monthly',
      YEARLY: 'yearly',
      DATE: 'date',
      TIME_INTERVAL: 'timeInterval',
    },
  };
}
