// ---------------------------------------------------------------------------
// Kavi — Reminder Tool Input Validation
// ---------------------------------------------------------------------------
// Validates the structured `when`/`timezone` fields the model supplies for the
// reminder tool. Deliberately no natural-language parsing: the model resolves
// phrases like "tomorrow at 9" to explicit ISO-8601/HH:MM values, or passes a
// delay in seconds for "in 10 minutes", and this module only checks the shape.
// A delay is resolved against the clock when the call runs, so it never depends
// on the model's arithmetic over a timestamp that has aged since the request.

import type { ReminderRecurrence, ReminderRecurrenceKind } from './types';
import { hasExplicitOffset, parseLocalDateTimeParts } from './zonedTime';

const RECURRENCE_KINDS: ReadonlySet<string> = new Set<ReminderRecurrenceKind>([
  'once',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
]);

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Longest delay a one-off reminder accepts: a year. */
export const MAX_REMINDER_DELAY_SECONDS = 366 * 24 * 60 * 60;

/**
 * Repair hints describing exactly which fields need fixing: `missingFields`
 * lists fields that were genuinely absent; `invalidFields` lists fields that
 * were present but malformed. Kept separate so a model repairing a rejected
 * call is told the truth about which case it hit, instead of "missing" being
 * overloaded to also mean "present but wrong".
 */
export interface ReminderRepairFields {
  missingFields: string[];
  invalidFields: string[];
}

export type ReminderWhenValidation =
  | { ok: true; recurrence: ReminderRecurrence }
  | ({ ok: false; error: string } & ReminderRepairFields);

export type ReminderTimezoneValidation =
  | { ok: true; timezone: string }
  | ({ ok: false; error: string } & ReminderRepairFields);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Builds a "YYYY-MM-DDTHH:MM:SS" example from the device's current local date-time and zone. */
function buildLocalDateTimeExample(nowMs: number = Date.now()): { text: string; timezone: string } {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date(nowMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  const text =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return { text, timezone };
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** A one-off reminder `delaySeconds` from `nowMs`, as an absolute UTC instant. */
function parseOnceDelay(delaySeconds: unknown, nowMs: number): ReminderWhenValidation {
  if (
    typeof delaySeconds !== 'number' ||
    !Number.isFinite(delaySeconds) ||
    delaySeconds < 1 ||
    delaySeconds > MAX_REMINDER_DELAY_SECONDS
  ) {
    return {
      ok: false,
      error: `"when.delaySeconds" must be a number of seconds from 1 to ${MAX_REMINDER_DELAY_SECONDS}.`,
      missingFields: [],
      invalidFields: ['when.delaySeconds'],
    };
  }
  const at = new Date(nowMs + Math.round(delaySeconds * 1000)).toISOString();
  return { ok: true, recurrence: { kind: 'once', at } };
}

export function parseReminderWhen(
  raw: unknown,
  nowMs: number = Date.now(),
): ReminderWhenValidation {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      error: '"when" is required and must be an object.',
      missingFields: ['when'],
      invalidFields: [],
    };
  }
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: '"when" must be an object.',
      missingFields: [],
      invalidFields: ['when'],
    };
  }

  if (raw.kind === undefined) {
    return {
      ok: false,
      error: '"when.kind" is required and must be one of once, daily, weekdays, weekly, monthly.',
      missingFields: ['when.kind'],
      invalidFields: [],
    };
  }
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!RECURRENCE_KINDS.has(kind)) {
    return {
      ok: false,
      error: '"when.kind" must be one of once, daily, weekdays, weekly, monthly.',
      missingFields: [],
      invalidFields: ['when.kind'],
    };
  }

  if (kind === 'once') {
    if (isPresent(raw.delaySeconds)) {
      if (isPresent(raw.at)) {
        return {
          ok: false,
          error: 'Give either "when.at" or "when.delaySeconds" for kind "once", not both.',
          missingFields: [],
          invalidFields: ['when.at', 'when.delaySeconds'],
        };
      }
      return parseOnceDelay(raw.delaySeconds, nowMs);
    }
    if (!isPresent(raw.at)) {
      return {
        ok: false,
        error: '"when.at" or "when.delaySeconds" is required for kind "once".',
        missingFields: ['when.at'],
        invalidFields: [],
      };
    }
    if (typeof raw.at !== 'string') {
      return {
        ok: false,
        error: '"when.at" must be a string.',
        missingFields: [],
        invalidFields: ['when.at'],
      };
    }
    const atRaw = raw.at.trim();
    if (atRaw === '') {
      return {
        ok: false,
        error: '"when.at" or "when.delaySeconds" is required for kind "once".',
        missingFields: ['when.at'],
        invalidFields: [],
      };
    }
    const isValid = hasExplicitOffset(atRaw)
      ? !Number.isNaN(Date.parse(atRaw))
      : parseLocalDateTimeParts(atRaw) !== undefined;
    if (!isValid) {
      const example = buildLocalDateTimeExample();
      return {
        ok: false,
        error:
          '"when.at" must be a valid ISO-8601 date-time: either with an explicit UTC offset or "Z" ' +
          '(e.g. "2026-09-10T14:00:00-04:00"), or an offset-less local date-time paired with ' +
          `"timezone" — the preferred form when the caller already knows the IANA zone (e.g. ` +
          `"${example.text}" for right now in "${example.timezone}").`,
        missingFields: [],
        invalidFields: ['when.at'],
      };
    }
    return { ok: true, recurrence: { kind: 'once', at: atRaw } };
  }

  if (raw.time === undefined) {
    return {
      ok: false,
      error: '"when.time" is required in 24-hour "HH:MM" format for this recurrence kind.',
      missingFields: ['when.time'],
      invalidFields: [],
    };
  }
  const time = typeof raw.time === 'string' ? raw.time.trim() : '';
  if (!TIME_OF_DAY_RE.test(time)) {
    return {
      ok: false,
      error: '"when.time" must be in 24-hour "HH:MM" format for this recurrence kind (e.g. "09:00").',
      missingFields: [],
      invalidFields: ['when.time'],
    };
  }

  if (kind === 'daily' || kind === 'weekdays') {
    return { ok: true, recurrence: { kind, time } };
  }

  if (kind === 'weekly') {
    if (raw.weekday === undefined) {
      return {
        ok: false,
        error: '"when.weekday" is required for kind "weekly" (1=Monday .. 7=Sunday, ISO-8601).',
        missingFields: ['when.weekday'],
        invalidFields: [],
      };
    }
    const weekday = typeof raw.weekday === 'number' ? Math.trunc(raw.weekday) : NaN;
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      return {
        ok: false,
        error: '"when.weekday" must be an integer 1-7 (1=Monday .. 7=Sunday, ISO-8601).',
        missingFields: [],
        invalidFields: ['when.weekday'],
      };
    }
    return { ok: true, recurrence: { kind: 'weekly', time, weekday } };
  }

  // kind === 'monthly'
  if (raw.dayOfMonth === undefined) {
    return {
      ok: false,
      error: '"when.dayOfMonth" is required for kind "monthly" (1-31).',
      missingFields: ['when.dayOfMonth'],
      invalidFields: [],
    };
  }
  const dayOfMonth = typeof raw.dayOfMonth === 'number' ? Math.trunc(raw.dayOfMonth) : NaN;
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return {
      ok: false,
      error: '"when.dayOfMonth" must be an integer 1-31.',
      missingFields: [],
      invalidFields: ['when.dayOfMonth'],
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
    // `candidate` only ever falls back to the device zone when `raw` carried no
    // usable value, and that default is always a valid zone name, so reaching
    // here means a "timezone" was actually supplied and it was malformed —
    // never that it was absent.
    return {
      ok: false,
      error: `"timezone" is not a recognized IANA time zone: ${candidate}`,
      missingFields: [],
      invalidFields: ['timezone'],
    };
  }
}
