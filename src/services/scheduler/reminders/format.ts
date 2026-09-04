// ---------------------------------------------------------------------------
// Kavi — Reminder Time Formatting
// ---------------------------------------------------------------------------
// Formats an instant as an ISO-8601 date-time carrying the wall-clock time and
// explicit UTC offset for a given IANA zone, using only Intl (the same
// zero-dependency technique cron/schedule.ts already relies on for timezone
// handling — no date-time library is in the dependency manifest for this).

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, '0');
}

/** Minutes the given zone is ahead of UTC at `date` (negative when behind). */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Formats `ms` as `YYYY-MM-DDTHH:MM:SS±HH:MM` in the wall-clock time of `timeZone`. */
export function formatZonedIso(ms: number, timeZone: string): string {
  const date = new Date(ms);
  const offsetMinutes = getTimeZoneOffsetMinutes(date, timeZone);
  const local = new Date(date.getTime() + offsetMinutes * 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetRemainderMinutes = pad(Math.abs(offsetMinutes) % 60);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${offsetHours}:${offsetRemainderMinutes}`
  );
}
