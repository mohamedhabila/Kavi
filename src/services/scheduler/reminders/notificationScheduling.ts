// ---------------------------------------------------------------------------
// Kavi — Reminder Notification Scheduling
// ---------------------------------------------------------------------------
// Maps a reminder's recurrence to native expo-notifications triggers so the OS
// delivers it without the app running:
//   - once / monthly  -> a single DATE trigger for the next occurrence,
//                         re-armed by rearm.ts once it elapses (expo's native
//                         MONTHLY trigger has no timezone field and skips
//                         inconsistently across platforms for short months,
//                         so a re-armed DATE trigger is used instead).
//   - daily            -> a native DAILY trigger (self-repeating).
//   - weekly           -> a native WEEKLY trigger (self-repeating).
//   - weekdays         -> five native WEEKLY triggers, Monday through Friday
//                         (expo has no single "these weekdays" trigger).

import * as Notifications from 'expo-notifications';
import {
  cancelLocalNotification,
  scheduleTypedLocalNotification,
  type NotificationRouteData,
} from '../../notifications/service';
import { isoWeekdayToAppleWeekday, parseTimeOfDay } from './recurrence';
import type { ReminderRecord } from './types';

const WEEKDAY_ISO_VALUES = [1, 2, 3, 4, 5] as const;

export interface ScheduledReminderNotifications {
  notificationIds: string[];
  /** Set only for once/monthly: the instant the DATE trigger targets. */
  armedForMs?: number;
}

type ReminderForScheduling = Pick<ReminderRecord, 'id' | 'title' | 'notes' | 'recurrence' | 'timezone'>;

function buildRouteData(record: Pick<ReminderRecord, 'id'>): NotificationRouteData {
  return { screen: 'Reminders', reminderId: record.id, source: 'reminder' };
}

export async function scheduleReminderNotifications(
  record: ReminderForScheduling,
  nextFireAtMs: number | undefined,
): Promise<ScheduledReminderNotifications> {
  const body = record.notes?.trim() || '';
  const data = buildRouteData(record);
  const { recurrence } = record;

  switch (recurrence.kind) {
    case 'once':
    case 'monthly': {
      if (nextFireAtMs === undefined) {
        throw new Error('reminder has no future occurrence to schedule');
      }
      const scheduled = await scheduleTypedLocalNotification({
        identifier: `reminder-${record.id}`,
        title: record.title,
        body,
        data,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: nextFireAtMs },
      });
      return { notificationIds: [scheduled.id], armedForMs: nextFireAtMs };
    }
    case 'daily': {
      const { hour, minute } = parseTimeOfDay(recurrence.time);
      const scheduled = await scheduleTypedLocalNotification({
        identifier: `reminder-${record.id}`,
        title: record.title,
        body,
        data,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
      });
      return { notificationIds: [scheduled.id] };
    }
    case 'weekly': {
      const { hour, minute } = parseTimeOfDay(recurrence.time);
      const scheduled = await scheduleTypedLocalNotification({
        identifier: `reminder-${record.id}`,
        title: record.title,
        body,
        data,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: isoWeekdayToAppleWeekday(recurrence.weekday),
          hour,
          minute,
        },
      });
      return { notificationIds: [scheduled.id] };
    }
    case 'weekdays': {
      const { hour, minute } = parseTimeOfDay(recurrence.time);
      const notificationIds: string[] = [];
      for (const isoWeekday of WEEKDAY_ISO_VALUES) {
        const scheduled = await scheduleTypedLocalNotification({
          identifier: `reminder-${record.id}-dow-${isoWeekday}`,
          title: record.title,
          body,
          data,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: isoWeekdayToAppleWeekday(isoWeekday),
            hour,
            minute,
          },
        });
        notificationIds.push(scheduled.id);
      }
      return { notificationIds };
    }
  }
}

/** Best-effort per id, but aggregates and throws on any failure so callers can surface it. */
export async function cancelReminderNotifications(notificationIds: readonly string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  const results = await Promise.allSettled(notificationIds.map((id) => cancelLocalNotification(id)));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length > 0) {
    const detail = failures
      .map((failure) => (failure.reason instanceof Error ? failure.reason.message : String(failure.reason)))
      .join('; ');
    throw new Error(
      `Failed to cancel ${failures.length} of ${notificationIds.length} reminder notification(s): ${detail}`,
    );
  }
}
