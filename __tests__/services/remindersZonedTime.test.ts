import {
  hasExplicitOffset,
  parseLocalDateTimeParts,
  resolveLocalDateTimeToUtcMs,
} from '../../src/services/scheduler/reminders/zonedTime';

describe('hasExplicitOffset', () => {
  it('recognizes "Z" and numeric offsets', () => {
    expect(hasExplicitOffset('2026-09-10T14:00:00Z')).toBe(true);
    expect(hasExplicitOffset('2026-09-10T14:00:00-04:00')).toBe(true);
    expect(hasExplicitOffset('2026-09-10T14:00:00+0900')).toBe(true);
  });

  it('rejects an offset-less local date-time', () => {
    expect(hasExplicitOffset('2026-09-10T14:00:00')).toBe(false);
    expect(hasExplicitOffset('2026-09-10T14:00')).toBe(false);
  });
});

describe('parseLocalDateTimeParts', () => {
  it('parses with and without seconds', () => {
    expect(parseLocalDateTimeParts('2026-09-06T09:00:00')).toEqual({
      year: 2026,
      month: 9,
      day: 6,
      hour: 9,
      minute: 0,
      second: 0,
    });
    expect(parseLocalDateTimeParts('2026-09-06T09:00')).toEqual({
      year: 2026,
      month: 9,
      day: 6,
      hour: 9,
      minute: 0,
      second: 0,
    });
  });

  it('rejects a calendar-invalid date (Feb 30) instead of silently rolling it over', () => {
    expect(parseLocalDateTimeParts('2026-02-30T09:00:00')).toBeUndefined();
  });

  it('rejects malformed or non-local-date-time strings', () => {
    expect(parseLocalDateTimeParts('not a date')).toBeUndefined();
    expect(parseLocalDateTimeParts('2026-09-10T14:00:00Z')).toBeUndefined();
    expect(parseLocalDateTimeParts('2026-09-10T25:00:00')).toBeUndefined();
    expect(parseLocalDateTimeParts('2026-09-10')).toBeUndefined();
  });
});

describe('resolveLocalDateTimeToUtcMs', () => {
  it('resolves a plain (non-transition) local time in Europe/Amsterdam (CEST, UTC+2)', () => {
    const result = resolveLocalDateTimeToUtcMs(
      { year: 2026, month: 9, day: 6, hour: 9, minute: 0, second: 0 },
      'Europe/Amsterdam',
    );
    expect(result).toEqual({ utcMs: Date.parse('2026-09-06T07:00:00Z'), ambiguous: false, shifted: false });
  });

  it('resolves a plain (non-transition) local time in America/New_York (EDT, UTC-4)', () => {
    const result = resolveLocalDateTimeToUtcMs(
      { year: 2026, month: 9, day: 6, hour: 9, minute: 0, second: 0 },
      'America/New_York',
    );
    expect(result).toEqual({ utcMs: Date.parse('2026-09-06T13:00:00Z'), ambiguous: false, shifted: false });
  });

  it('shifts a DST spring-forward gap forward in Europe/Amsterdam (2026-03-29 02:00->03:00 CEST)', () => {
    const result = resolveLocalDateTimeToUtcMs(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 },
      'Europe/Amsterdam',
    );
    expect(result.shifted).toBe(true);
    expect(result.ambiguous).toBe(false);
    // Shifted forward past the gap: local reads 03:30 CEST (UTC+2) == 01:30Z.
    expect(result.utcMs).toBe(Date.parse('2026-03-29T01:30:00Z'));
  });

  it('shifts a DST spring-forward gap forward in America/New_York (2026-03-08 02:00->03:00 EDT)', () => {
    const result = resolveLocalDateTimeToUtcMs(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
      'America/New_York',
    );
    expect(result.shifted).toBe(true);
    expect(result.ambiguous).toBe(false);
    // Shifted forward past the gap: local reads 03:30 EDT (UTC-4) == 07:30Z.
    expect(result.utcMs).toBe(Date.parse('2026-03-08T07:30:00Z'));
  });

  it('resolves a DST fall-back overlap in Europe/Amsterdam to the earlier instant (2026-10-25 03:00->02:00 CET)', () => {
    const result = resolveLocalDateTimeToUtcMs(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 },
      'Europe/Amsterdam',
    );
    expect(result.ambiguous).toBe(true);
    expect(result.shifted).toBe(false);
    // Earlier occurrence: 02:30 CEST (UTC+2) == 00:30Z, not the later 02:30 CET (01:30Z).
    expect(result.utcMs).toBe(Date.parse('2026-10-25T00:30:00Z'));
  });

  it('resolves a DST fall-back overlap in America/New_York to the earlier instant (2026-11-01 02:00->01:00 EST)', () => {
    const result = resolveLocalDateTimeToUtcMs(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      'America/New_York',
    );
    expect(result.ambiguous).toBe(true);
    expect(result.shifted).toBe(false);
    // Earlier occurrence: 01:30 EDT (UTC-4) == 05:30Z, not the later 01:30 EST (06:30Z).
    expect(result.utcMs).toBe(Date.parse('2026-11-01T05:30:00Z'));
  });
});
