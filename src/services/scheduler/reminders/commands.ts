// ---------------------------------------------------------------------------
// Kavi — Reminder Commands
// ---------------------------------------------------------------------------
// High-level create/list/update/cancel operations combining the store, the
// recurrence math, and native notification scheduling. This is what the
// reminder tool executor calls.

import { generateId } from '../../../utils/id';
import { computeReminderNextFireAtMs } from './recurrence';
import {
  cancelReminderNotifications,
  scheduleReminderNotifications,
} from './notificationScheduling';
import { deleteReminderRow, getReminder, insertReminder, listPendingReminders, updateReminderRow } from './store';
import type { ReminderRecord, ReminderRecurrence } from './types';

export class ReminderCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'ReminderCommandError';
    this.code = code;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface CreateReminderInput {
  title: string;
  notes?: string;
  recurrence: ReminderRecurrence;
  timezone: string;
}

export async function createReminder(input: CreateReminderInput): Promise<ReminderRecord> {
  const title = input.title.trim();
  if (!title) {
    throw new ReminderCommandError('reminder_title_required', 'A reminder title is required.');
  }

  const nowMs = Date.now();
  const nextFireAtMs = computeReminderNextFireAtMs(input.recurrence, input.timezone, nowMs);
  if (nextFireAtMs === undefined) {
    throw new ReminderCommandError(
      'reminder_schedule_invalid',
      'This reminder has no future occurrence with the given schedule.',
    );
  }

  const id = generateId();
  const notes = input.notes?.trim() || undefined;
  let scheduled;
  try {
    scheduled = await scheduleReminderNotifications(
      { id, title, notes, recurrence: input.recurrence, timezone: input.timezone },
      nextFireAtMs,
    );
  } catch (error) {
    throw new ReminderCommandError(
      'reminder_notification_schedule_failed',
      `Could not schedule the reminder notification: ${errorMessage(error)}`,
      error,
    );
  }

  return insertReminder(id, {
    title,
    notes,
    recurrence: input.recurrence,
    timezone: input.timezone,
    status: 'pending',
    nextFireAtMs,
    armedForMs: scheduled.armedForMs,
    notificationIds: scheduled.notificationIds,
  });
}

/**
 * For daily/weekly/weekdays the OS trigger repeats on its own, so the stored
 * next-fire column is only refreshed at create/update time. Recompute it live
 * for display rather than trusting a value that can go stale between runs.
 */
function withLiveNextFireAtMs(reminder: ReminderRecord, nowMs: number): ReminderRecord {
  if (reminder.recurrence.kind === 'once' || reminder.recurrence.kind === 'monthly') {
    return reminder;
  }
  const nextFireAtMs = computeReminderNextFireAtMs(reminder.recurrence, reminder.timezone, nowMs);
  return nextFireAtMs === undefined ? reminder : { ...reminder, nextFireAtMs };
}

export function listReminders(nowMs: number = Date.now()): ReminderRecord[] {
  // The store sorts by the persisted next_fire_at_ms, which only the once/monthly
  // rows keep current (see withLiveNextFireAtMs above) — a daily/weekly/weekdays
  // row's stored value goes stale as soon as real time moves past its creation.
  // Re-sort after recomputing live values so the result is always actually
  // ordered by next fire time, not by however stale the stored column is.
  return listPendingReminders()
    .map((reminder) => withLiveNextFireAtMs(reminder, nowMs))
    .sort((a, b) => (a.nextFireAtMs ?? Infinity) - (b.nextFireAtMs ?? Infinity));
}

export interface UpdateReminderInput {
  title?: string;
  notes?: string;
  recurrence?: ReminderRecurrence;
  timezone?: string;
}

export async function updateReminder(id: string, updates: UpdateReminderInput): Promise<ReminderRecord> {
  const existing = getReminder(id);
  if (!existing || existing.status !== 'pending') {
    throw new ReminderCommandError('reminder_not_found', `No pending reminder found for id: ${id}`);
  }

  const title = updates.title !== undefined ? updates.title.trim() : existing.title;
  if (!title) {
    throw new ReminderCommandError('reminder_title_required', 'A reminder title is required.');
  }
  const notes = updates.notes !== undefined ? updates.notes.trim() || undefined : existing.notes;
  const timezone = updates.timezone ?? existing.timezone;
  const recurrence = updates.recurrence ?? existing.recurrence;

  const nowMs = Date.now();
  const nextFireAtMs = computeReminderNextFireAtMs(recurrence, timezone, nowMs);
  if (nextFireAtMs === undefined) {
    throw new ReminderCommandError(
      'reminder_schedule_invalid',
      'This reminder has no future occurrence with the given schedule.',
    );
  }

  try {
    await cancelReminderNotifications(existing.notificationIds);
  } catch (error) {
    throw new ReminderCommandError(
      'reminder_notification_cancel_failed',
      `Could not cancel the previous reminder notification: ${errorMessage(error)}`,
      error,
    );
  }

  let scheduled;
  try {
    scheduled = await scheduleReminderNotifications({ id, title, notes, recurrence, timezone }, nextFireAtMs);
  } catch (error) {
    throw new ReminderCommandError(
      'reminder_notification_schedule_failed',
      `Could not schedule the updated reminder notification: ${errorMessage(error)}`,
      error,
    );
  }

  const updated = updateReminderRow(id, {
    title,
    notes,
    recurrence,
    timezone,
    status: 'pending',
    nextFireAtMs,
    armedForMs: scheduled.armedForMs,
    notificationIds: scheduled.notificationIds,
  });
  if (!updated) {
    throw new ReminderCommandError('reminder_not_found', `No pending reminder found for id: ${id}`);
  }
  return updated;
}

export async function cancelReminder(id: string): Promise<void> {
  const existing = getReminder(id);
  if (!existing) {
    throw new ReminderCommandError('reminder_not_found', `No reminder found for id: ${id}`);
  }
  try {
    await cancelReminderNotifications(existing.notificationIds);
  } catch (error) {
    throw new ReminderCommandError(
      'reminder_notification_cancel_failed',
      `Could not cancel the reminder notification: ${errorMessage(error)}`,
      error,
    );
  }
  deleteReminderRow(id);
}
