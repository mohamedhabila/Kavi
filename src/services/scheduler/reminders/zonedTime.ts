// ---------------------------------------------------------------------------
// Kavi — Reminder Zoned Local Time Resolution
// ---------------------------------------------------------------------------
// Resolves an offset-less local wall-clock date-time (e.g. "2026-09-06T09:00:00")
// against an IANA time zone into an absolute UTC instant. No date-time library
// (Luxon, date-fns-tz, ...) is in this project's dependency manifest, and
// installing one is out of scope for this change, so this reuses the same
// Intl-based UTC-offset lookup format.ts already relies on for the reverse
// direction (instant -> zoned display string): getTimeZoneOffsetMinutes.
// The two-candidate bracketing technique below (look up the zone's offset a
// day on each side of the target date, then verify by round-tripping) is the
// same fixed-point approach general-purpose date-time libraries use
// internally for local-time-to-UTC conversion; it avoids the classic bug of
// letting the naive instant itself bias which side of a DST transition gets
// sampled.

import { getTimeZoneOffsetMinutes } from './format';

const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export interface LocalDateTimeParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface ZonedResolution {
  /** Resolved instant, epoch ms. */
  utcMs: number;
  /** The local time occurred twice (DST fall-back); the earlier of the two instants was chosen. */
  ambiguous: boolean;
  /** The local time never occurred (DST spring-forward gap); shifted forward to the first valid instant. */
  shifted: boolean;
}

/** True when `raw` already carries an explicit UTC offset ("Z" or "+HH:MM"/"-HH:MM"). */
export function hasExplicitOffset(raw: string): boolean {
  return ISO_OFFSET_RE.test(raw);
}

/**
 * Parses an offset-less "YYYY-MM-DDTHH:MM[:SS]" local date-time. Rejects
 * syntactically-invalid strings and calendar-invalid dates (e.g. Feb 30,
 * which `Date.UTC` would otherwise silently roll into March).
 */
export function parseLocalDateTimeParts(raw: string): LocalDateTimeParts | undefined {
  const match = LOCAL_DATE_TIME_RE.exec(raw.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;

  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(asUtcMs);
  const isValidCalendarDate =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day &&
    roundTrip.getUTCHours() === hour &&
    roundTrip.getUTCMinutes() === minute &&
    roundTrip.getUTCSeconds() === second;
  if (!isValidCalendarDate) return undefined;

  return { year, month, day, hour, minute, second };
}

function localPartsAtUtcMs(utcMs: number, timeZone: string): LocalDateTimeParts {
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone);
  const local = new Date(utcMs + offsetMinutes * 60000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

function partsEqual(a: LocalDateTimeParts, b: LocalDateTimeParts): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * Resolves local wall-clock components in `timeZone` to an absolute UTC
 * instant, DST-correct on both sides of a transition:
 *  - A local time inside a spring-forward gap (it never occurs) is shifted
 *    forward to the first valid instant after the gap, the same behavior
 *    calendar apps use.
 *  - A local time inside a fall-back overlap (it occurs twice) resolves to
 *    the earlier of the two instants.
 *
 * The naive instant (the input components read as if they were UTC) is not
 * used directly to probe the zone's offset — near a transition that would
 * bias which side gets sampled and could silently pick the wrong occurrence
 * of an ambiguous time. Instead the offset is sampled a day on each side of
 * the target date (always outside any single DST transition window) and
 * both resulting candidates are verified by formatting them back and
 * comparing to the requested wall-clock components.
 */
export function resolveLocalDateTimeToUtcMs(parts: LocalDateTimeParts, timeZone: string): ZonedResolution {
  const naiveUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  const offsetEarlierMinutes = getTimeZoneOffsetMinutes(new Date(naiveUtcMs - DAY_MS), timeZone);
  const offsetLaterMinutes = getTimeZoneOffsetMinutes(new Date(naiveUtcMs + DAY_MS), timeZone);

  const candidateEarlier = naiveUtcMs - offsetEarlierMinutes * 60000;
  const candidateLater = naiveUtcMs - offsetLaterMinutes * 60000;

  if (candidateEarlier === candidateLater) {
    return { utcMs: candidateEarlier, ambiguous: false, shifted: false };
  }

  const matchesEarlier = partsEqual(localPartsAtUtcMs(candidateEarlier, timeZone), parts);
  const matchesLater = partsEqual(localPartsAtUtcMs(candidateLater, timeZone), parts);

  if (matchesEarlier && matchesLater) {
    return { utcMs: Math.min(candidateEarlier, candidateLater), ambiguous: true, shifted: false };
  }
  if (matchesEarlier) {
    return { utcMs: candidateEarlier, ambiguous: false, shifted: false };
  }
  if (matchesLater) {
    return { utcMs: candidateLater, ambiguous: false, shifted: false };
  }

  // Neither candidate reproduces the requested wall clock: it falls inside a
  // DST spring-forward gap. Shift forward to the later candidate, which is
  // the first valid instant past the gap.
  return { utcMs: Math.max(candidateEarlier, candidateLater), ambiguous: false, shifted: true };
}
