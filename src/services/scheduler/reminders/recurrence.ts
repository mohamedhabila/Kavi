// ---------------------------------------------------------------------------
// Kavi — Reminder Recurrence Math
// ---------------------------------------------------------------------------
// Reuses the existing croner-backed cron schedule evaluator (already relied on
// for DST-correct IANA timezone math elsewhere in the scheduler) instead of
// hand-rolling calendar arithmetic: every recurrence kind except `once` is
// expressed as a 5-field cron expression and handed to computeNextRunAtMs.

import { computeNextRunAtMs } from '../../cron/schedule';
import type { CronSchedule } from '../../cron/types';
import type { ReminderRecurrence } from './types';
import { hasExplicitOffset, parseLocalDateTimeParts, resolveLocalDateTimeToUtcMs } from './zonedTime';

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimeOfDay(time: string): { hour: number; minute: number } {
  const match = TIME_OF_DAY_RE.exec(time.trim());
  if (!match) {
    throw new Error(`invalid reminder time "${time}"; expected 24-hour "HH:MM"`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Cron day-of-week is 0-6 with 0=Sunday; our schema is ISO-8601 (1=Monday..7=Sunday). */
export function isoWeekdayToCronDow(isoWeekday: number): number {
  return isoWeekday === 7 ? 0 : isoWeekday;
}

/** expo-notifications' WEEKLY trigger uses Apple's convention: 1=Sunday..7=Saturday. */
export function isoWeekdayToAppleWeekday(isoWeekday: number): number {
  return (isoWeekday % 7) + 1;
}

function recurrenceToCronExpr(recurrence: Exclude<ReminderRecurrence, { kind: 'once' }>): string {
  switch (recurrence.kind) {
    case 'daily': {
      const { hour, minute } = parseTimeOfDay(recurrence.time);
      return `${minute} ${hour} * * *`;
    }
    case 'weekdays': {
      const { hour, minute } = parseTimeOfDay(recurrence.time);
      return `${minute} ${hour} * * 1-5`;
    }
    case 'weekly': {
      const { hour, minute } = parseTimeOfDay(recurrence.time);
      return `${minute} ${hour} * * ${isoWeekdayToCronDow(recurrence.weekday)}`;
    }
    case 'monthly': {
      const { hour, minute } = parseTimeOfDay(recurrence.time);
      return `${minute} ${hour} ${recurrence.dayOfMonth} * *`;
    }
  }
}

/**
 * Builds the `at`-kind cron schedule for a `once` reminder. `at` either
 * already carries an explicit UTC offset (passed through unchanged — its
 * instant does not depend on `timezone`), or is an offset-less local
 * date-time that must be resolved against `timezone` using the same
 * DST-correct machinery `resolveLocalDateTimeToUtcMs` provides. Returns
 * undefined only if `at` is neither (validation upstream in input.ts should
 * already have rejected that, so this is a defense-in-depth fallback).
 */
function resolveOnceSchedule(at: string, timezone: string): CronSchedule | undefined {
  if (hasExplicitOffset(at)) {
    return { kind: 'at', at };
  }
  const parts = parseLocalDateTimeParts(at);
  if (!parts) return undefined;
  const { utcMs } = resolveLocalDateTimeToUtcMs(parts, timezone);
  return { kind: 'at', atMs: utcMs };
}

/**
 * Next fire time in epoch ms for a reminder recurrence, evaluated in
 * `timezone`. Returns undefined when the schedule has no future occurrence
 * (e.g. a `once` reminder whose `at` has already passed) or, for `once`,
 * when `at` cannot be resolved at all.
 */
export function computeReminderNextFireAtMs(
  recurrence: ReminderRecurrence,
  timezone: string,
  nowMs: number,
): number | undefined {
  const schedule =
    recurrence.kind === 'once'
      ? resolveOnceSchedule(recurrence.at, timezone)
      : ({ kind: 'cron', expr: recurrenceToCronExpr(recurrence), tz: timezone } satisfies CronSchedule);
  if (!schedule) return undefined;
  return computeNextRunAtMs(schedule, nowMs);
}
