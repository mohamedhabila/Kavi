// ---------------------------------------------------------------------------
// Kavi — Reminder Re-arm / Reconcile
// ---------------------------------------------------------------------------
// once/monthly reminders use a single native DATE trigger for their next
// occurrence. Once that instant elapses, a `once` reminder is done (marked
// fired) and a `monthly` reminder needs its next month's DATE trigger armed.
// daily/weekly/weekdays use self-repeating native triggers and never need
// re-arming here.
//
// Hooked into the same lifecycle the cron scheduler's wake notifications use
// (src/services/scheduler/maintenance.ts for the ~15 minute background task,
// src/services/scheduler/runtimeReadiness.ts for foreground activation) so
// this runs opportunistically without a dedicated timer.

import { createLogger } from '../../../utils/logger';
import { computeReminderNextFireAtMs } from './recurrence';
import { cancelReminderNotifications, scheduleReminderNotifications } from './notificationScheduling';
import { listAllReminders, updateReminderRow } from './store';

const logger = createLogger('reminders.rearm');

export interface ReminderReconcileResult {
  warnings: string[];
}

export async function reconcilePendingReminders(nowMs: number = Date.now()): Promise<ReminderReconcileResult> {
  const warnings: string[] = [];
  const pending = listAllReminders().filter((reminder) => reminder.status === 'pending');

  for (const reminder of pending) {
    if (reminder.recurrence.kind !== 'once' && reminder.recurrence.kind !== 'monthly') {
      continue;
    }
    if (reminder.armedForMs !== undefined && reminder.armedForMs > nowMs) {
      continue;
    }

    if (reminder.recurrence.kind === 'once') {
      updateReminderRow(reminder.id, {
        title: reminder.title,
        notes: reminder.notes,
        recurrence: reminder.recurrence,
        timezone: reminder.timezone,
        status: 'fired',
        nextFireAtMs: reminder.nextFireAtMs,
        armedForMs: reminder.armedForMs,
        notificationIds: reminder.notificationIds,
      });
      continue;
    }

    const baselineMs = reminder.armedForMs ?? nowMs;
    const nextFireAtMs = computeReminderNextFireAtMs(reminder.recurrence, reminder.timezone, baselineMs);
    if (nextFireAtMs === undefined) {
      warnings.push(`Could not compute the next occurrence for reminder "${reminder.title}".`);
      continue;
    }

    try {
      await cancelReminderNotifications(reminder.notificationIds);
      const scheduled = await scheduleReminderNotifications(reminder, nextFireAtMs);
      updateReminderRow(reminder.id, {
        title: reminder.title,
        notes: reminder.notes,
        recurrence: reminder.recurrence,
        timezone: reminder.timezone,
        status: 'pending',
        nextFireAtMs,
        armedForMs: scheduled.armedForMs,
        notificationIds: scheduled.notificationIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to re-arm reminder "${reminder.title}": ${message}`);
      logger.warn('[reconcilePendingReminders] re-arm failed', { id: reminder.id, message });
    }
  }

  return { warnings };
}
