// ---------------------------------------------------------------------------
// Kavi — Reminder Tool Input Validation
// ---------------------------------------------------------------------------
// Validates the structured `when`/`timezone` fields the model supplies for the
// reminder tool. Deliberately no natural-language parsing: the model resolves
// relative phrases ("tomorrow", "in an hour") to explicit ISO-8601/HH:MM
// values before calling, and this module only checks the resulting shape.

import type { ReminderRecurrence, ReminderRecurrenceKind } from './types';

const RECURRENCE_KINDS: ReadonlySet<string> = new Set<ReminderRecurrenceKind>([
  'once',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
]);

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

export type ReminderWhenValidation =
  | { ok: true; recurrence: ReminderRecurrence }
  | { ok: false; error: string; missingFields: string[] };

export type ReminderTimezoneValidation =
  | { ok: true; timezone: string }
  | { ok: false; error: string; missingFields: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseReminderWhen(raw: unknown): ReminderWhenValidation {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: '"when" is required and must be an object.',
      missingFields: ['when'],
    };
  }

  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!RECURRENCE_KINDS.has(kind)) {
    return {
      ok: false,
      error: '"when.kind" must be one of once, daily, weekdays, weekly, monthly.',
      missingFields: ['when.kind'],
    };
  }

  if (kind === 'once') {
    const at = typeof raw.at === 'string' ? raw.at.trim() : '';
    if (!at) {
      return {
        ok: false,
        error: '"when.at" is required for kind "once".',
        missingFields: ['when.at'],
      };
    }
    if (!ISO_OFFSET_RE.test(at) || Number.isNaN(Date.parse(at))) {
      return {
        ok: false,
        error:
          '"when.at" must be a valid ISO-8601 date-time with an explicit UTC offset or "Z" (e.g. 2026-09-10T14:00:00-04:00).',
        missingFields: ['when.at'],
      };
    }
    return { ok: true, recurrence: { kind: 'once', at } };
  }

  const time = typeof raw.time === 'string' ? raw.time.trim() : '';
  if (!TIME_OF_DAY_RE.test(time)) {
    return {
      ok: false,
      error: '"when.time" is required in 24-hour "HH:MM" format for this recurrence kind.',
      missingFields: ['when.time'],
    };
  }

  if (kind === 'daily' || kind === 'weekdays') {
    return { ok: true, recurrence: { kind, time } };
  }

  if (kind === 'weekly') {
    const weekday = typeof raw.weekday === 'number' ? Math.trunc(raw.weekday) : NaN;
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      return {
        ok: false,
        error: '"when.weekday" is required for kind "weekly" (1=Monday .. 7=Sunday, ISO-8601).',
        missingFields: ['when.weekday'],
      };
    }
    return { ok: true, recurrence: { kind: 'weekly', time, weekday } };
  }

  // kind === 'monthly'
  const dayOfMonth = typeof raw.dayOfMonth === 'number' ? Math.trunc(raw.dayOfMonth) : NaN;
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return {
      ok: false,
      error: '"when.dayOfMonth" is required for kind "monthly" (1-31).',
      missingFields: ['when.dayOfMonth'],
    };
  }
  return { ok: true, recurrence: { kind: 'monthly', time, dayOfMonth } };
}

export function resolveReminderTimezone(raw: unknown): ReminderTimezoneValidation {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const candidate = trimmed || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    // Throws RangeError for a syntactically or semantically invalid zone.
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return { ok: true, timezone: candidate };
  } catch {
    return {
      ok: false,
      error: `"timezone" is not a recognized IANA time zone: ${candidate}`,
      missingFields: ['timezone'],
    };
  }
}
