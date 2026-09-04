// ---------------------------------------------------------------------------
// Kavi — Reminders Store
// ---------------------------------------------------------------------------
// Thin CRUD layer over the reminders SQLite table. Every mutator takes (or
// returns) a full ReminderRecord — there is no partial/undefined-keeps-
// existing-value ambiguity — so callers in commands.ts and rearm.ts always
// pass the complete next state they computed.

import { getRemindersDb } from './database';
import type { ReminderRecord, ReminderRecurrence, ReminderStatus } from './types';

interface ReminderRow {
  id: string;
  title: string;
  notes: string | null;
  recurrence_kind: string;
  recurrence_time: string | null;
  recurrence_weekday: number | null;
  recurrence_day_of_month: number | null;
  recurrence_at: string | null;
  timezone: string;
  status: string;
  next_fire_at_ms: number | null;
  armed_for_ms: number | null;
  notification_ids: string;
  created_at_ms: number;
  updated_at_ms: number;
}

function recurrenceFromRow(row: ReminderRow): ReminderRecurrence {
  switch (row.recurrence_kind) {
    case 'once':
      if (!row.recurrence_at) {
        throw new Error(`reminder ${row.id} is missing recurrence_at for kind "once"`);
      }
      return { kind: 'once', at: row.recurrence_at };
    case 'daily':
      if (!row.recurrence_time) {
        throw new Error(`reminder ${row.id} is missing recurrence_time for kind "daily"`);
      }
      return { kind: 'daily', time: row.recurrence_time };
    case 'weekdays':
      if (!row.recurrence_time) {
        throw new Error(`reminder ${row.id} is missing recurrence_time for kind "weekdays"`);
      }
      return { kind: 'weekdays', time: row.recurrence_time };
    case 'weekly':
      if (!row.recurrence_time || row.recurrence_weekday === null) {
        throw new Error(`reminder ${row.id} is missing time/weekday for kind "weekly"`);
      }
      return { kind: 'weekly', time: row.recurrence_time, weekday: row.recurrence_weekday };
    case 'monthly':
      if (!row.recurrence_time || row.recurrence_day_of_month === null) {
        throw new Error(`reminder ${row.id} is missing time/dayOfMonth for kind "monthly"`);
      }
      return {
        kind: 'monthly',
        time: row.recurrence_time,
        dayOfMonth: row.recurrence_day_of_month,
      };
    default:
      throw new Error(`reminder ${row.id} has an unknown recurrence_kind "${row.recurrence_kind}"`);
  }
}

function statusFromRow(status: string): ReminderStatus {
  return status === 'fired' || status === 'cancelled' ? status : 'pending';
}

function notificationIdsFromRow(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    recurrence: recurrenceFromRow(row),
    timezone: row.timezone,
    status: statusFromRow(row.status),
    nextFireAtMs: row.next_fire_at_ms ?? undefined,
    armedForMs: row.armed_for_ms ?? undefined,
    notificationIds: notificationIdsFromRow(row.notification_ids),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function recurrenceColumns(recurrence: ReminderRecurrence): {
  recurrence_kind: string;
  recurrence_time: string | null;
  recurrence_weekday: number | null;
  recurrence_day_of_month: number | null;
  recurrence_at: string | null;
} {
  switch (recurrence.kind) {
    case 'once':
      return {
        recurrence_kind: 'once',
        recurrence_time: null,
        recurrence_weekday: null,
        recurrence_day_of_month: null,
        recurrence_at: recurrence.at,
      };
    case 'daily':
      return {
        recurrence_kind: 'daily',
        recurrence_time: recurrence.time,
        recurrence_weekday: null,
        recurrence_day_of_month: null,
        recurrence_at: null,
      };
    case 'weekdays':
      return {
        recurrence_kind: 'weekdays',
        recurrence_time: recurrence.time,
        recurrence_weekday: null,
        recurrence_day_of_month: null,
        recurrence_at: null,
      };
    case 'weekly':
      return {
        recurrence_kind: 'weekly',
        recurrence_time: recurrence.time,
        recurrence_weekday: recurrence.weekday,
        recurrence_day_of_month: null,
        recurrence_at: null,
      };
    case 'monthly':
      return {
        recurrence_kind: 'monthly',
        recurrence_time: recurrence.time,
        recurrence_weekday: null,
        recurrence_day_of_month: recurrence.dayOfMonth,
        recurrence_at: null,
      };
  }
}

export interface ReminderRowInput {
  title: string;
  notes?: string;
  recurrence: ReminderRecurrence;
  timezone: string;
  status: ReminderStatus;
  nextFireAtMs?: number;
  armedForMs?: number;
  notificationIds: string[];
}

export function insertReminder(id: string, input: ReminderRowInput): ReminderRecord {
  const db = getRemindersDb();
  const cols = recurrenceColumns(input.recurrence);
  const now = Date.now();
  db.runSync(
    `INSERT INTO reminders (
       id, title, notes, recurrence_kind, recurrence_time, recurrence_weekday,
       recurrence_day_of_month, recurrence_at, timezone, status, next_fire_at_ms,
       armed_for_ms, notification_ids, created_at_ms, updated_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title,
    input.notes ?? null,
    cols.recurrence_kind,
    cols.recurrence_time,
    cols.recurrence_weekday,
    cols.recurrence_day_of_month,
    cols.recurrence_at,
    input.timezone,
    input.status,
    input.nextFireAtMs ?? null,
    input.armedForMs ?? null,
    JSON.stringify(input.notificationIds),
    now,
    now,
  );
  const record = getReminder(id);
  if (!record) throw new Error(`reminder_insert_failed: row ${id} not found after insert`);
  return record;
}

export function getReminder(id: string): ReminderRecord | undefined {
  const row = getRemindersDb().getFirstSync<ReminderRow>('SELECT * FROM reminders WHERE id = ?', id);
  return row ? rowToRecord(row) : undefined;
}

export function listPendingReminders(): ReminderRecord[] {
  const rows = getRemindersDb().getAllSync<ReminderRow>(
    "SELECT * FROM reminders WHERE status = 'pending' ORDER BY next_fire_at_ms ASC",
  );
  return rows.map(rowToRecord);
}

export function listAllReminders(): ReminderRecord[] {
  const rows = getRemindersDb().getAllSync<ReminderRow>(
    'SELECT * FROM reminders ORDER BY next_fire_at_ms ASC',
  );
  return rows.map(rowToRecord);
}

export function updateReminderRow(id: string, next: ReminderRowInput): ReminderRecord | undefined {
  const db = getRemindersDb();
  const cols = recurrenceColumns(next.recurrence);
  const result = db.runSync(
    `UPDATE reminders SET
       title = ?, notes = ?, recurrence_kind = ?, recurrence_time = ?, recurrence_weekday = ?,
       recurrence_day_of_month = ?, recurrence_at = ?, timezone = ?, status = ?,
       next_fire_at_ms = ?, armed_for_ms = ?, notification_ids = ?, updated_at_ms = ?
     WHERE id = ?`,
    next.title,
    next.notes ?? null,
    cols.recurrence_kind,
    cols.recurrence_time,
    cols.recurrence_weekday,
    cols.recurrence_day_of_month,
    cols.recurrence_at,
    next.timezone,
    next.status,
    next.nextFireAtMs ?? null,
    next.armedForMs ?? null,
    JSON.stringify(next.notificationIds),
    Date.now(),
    id,
  );
  if (result.changes === 0) return undefined;
  return getReminder(id);
}

export function deleteReminderRow(id: string): boolean {
  const result = getRemindersDb().runSync('DELETE FROM reminders WHERE id = ?', id);
  return result.changes > 0;
}
