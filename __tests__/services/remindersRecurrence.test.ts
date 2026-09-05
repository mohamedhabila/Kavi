import {
  computeReminderNextFireAtMs,
  isoWeekdayToAppleWeekday,
  isoWeekdayToCronDow,
  parseTimeOfDay,
} from '../../src/services/scheduler/reminders/recurrence';
import type { ReminderRecurrence } from '../../src/services/scheduler/reminders/types';

describe('parseTimeOfDay', () => {
  it('parses valid 24-hour times', () => {
    expect(parseTimeOfDay('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeOfDay('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeOfDay('09:05')).toEqual({ hour: 9, minute: 5 });
  });

  it('rejects malformed times', () => {
    expect(() => parseTimeOfDay('24:00')).toThrow();
    expect(() => parseTimeOfDay('9:00')).toThrow();
    expect(() => parseTimeOfDay('09:60')).toThrow();
    expect(() => parseTimeOfDay('not a time')).toThrow();
  });
});

describe('weekday conversions', () => {
  it('maps ISO weekday to cron day-of-week (0=Sunday)', () => {
    expect(isoWeekdayToCronDow(1)).toBe(1); // Monday
    expect(isoWeekdayToCronDow(6)).toBe(6); // Saturday
    expect(isoWeekdayToCronDow(7)).toBe(0); // Sunday
  });

  it('maps ISO weekday to Apple/expo weekday (1=Sunday)', () => {
    expect(isoWeekdayToAppleWeekday(1)).toBe(2); // Monday -> 2
    expect(isoWeekdayToAppleWeekday(6)).toBe(7); // Saturday -> 7
    expect(isoWeekdayToAppleWeekday(7)).toBe(1); // Sunday -> 1
  });
});

describe('computeReminderNextFireAtMs', () => {
  it('once: returns the parsed instant when in the future', () => {
    const recurrence: ReminderRecurrence = { kind: 'once', at: '2026-09-10T14:00:00-04:00' };
    const nowMs = Date.parse('2026-09-01T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'America/New_York', nowMs);
    expect(next).toBe(Date.parse('2026-09-10T14:00:00-04:00'));
  });

  it('once: returns undefined once the instant has passed', () => {
    const recurrence: ReminderRecurrence = { kind: 'once', at: '2020-01-01T00:00:00Z' };
    const next = computeReminderNextFireAtMs(recurrence, 'UTC', Date.now());
    expect(next).toBeUndefined();
  });

  it('once: resolves an offset-less local "at" against "timezone" (Europe/Amsterdam, CEST)', () => {
    const recurrence: ReminderRecurrence = { kind: 'once', at: '2026-09-06T09:00:00' };
    const nowMs = Date.parse('2026-09-01T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'Europe/Amsterdam', nowMs);
    // 2026-09-06 is well clear of any DST transition: CEST is UTC+2.
    expect(next).toBe(Date.parse('2026-09-06T07:00:00Z'));
  });

  it('once: resolves an offset-less local "at" against "timezone" (America/New_York, EDT)', () => {
    const recurrence: ReminderRecurrence = { kind: 'once', at: '2026-09-06T09:00:00' };
    const nowMs = Date.parse('2026-09-01T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'America/New_York', nowMs);
    expect(next).toBe(Date.parse('2026-09-06T13:00:00Z'));
  });

  it('once: resolves an offset-less local "at" on the far side of a DST spring-forward in Europe/Amsterdam', () => {
    // DST begins 2026-03-29 at 02:00 CET -> 03:00 CEST; 09:00 local that day is already CEST.
    const recurrence: ReminderRecurrence = { kind: 'once', at: '2026-03-29T09:00:00' };
    const nowMs = Date.parse('2026-03-01T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'Europe/Amsterdam', nowMs);
    expect(next).toBe(Date.parse('2026-03-29T07:00:00Z'));
  });

  it('once: resolves an offset-less local "at" on the far side of a DST fall-back in America/New_York', () => {
    // DST ends 2026-11-01 at 02:00 EDT -> 01:00 EST; 09:00 local that day is already back to EST.
    const recurrence: ReminderRecurrence = { kind: 'once', at: '2026-11-01T09:00:00' };
    const nowMs = Date.parse('2026-10-01T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'America/New_York', nowMs);
    expect(next).toBe(Date.parse('2026-11-01T14:00:00Z'));
  });

  it('once: shifts an offset-less local "at" inside a DST spring-forward gap forward (Europe/Amsterdam)', () => {
    // 02:30 local on 2026-03-29 does not exist (clocks jump 02:00 -> 03:00 CEST).
    const recurrence: ReminderRecurrence = { kind: 'once', at: '2026-03-29T02:30:00' };
    const nowMs = Date.parse('2026-03-01T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'Europe/Amsterdam', nowMs);
    // Shifted forward past the gap: local reads 03:30 CEST (UTC+2).
    expect(next).toBe(Date.parse('2026-03-29T01:30:00Z'));
  });

  it('once: an "at" carrying an explicit offset is unaffected by "timezone"', () => {
    const recurrence: ReminderRecurrence = { kind: 'once', at: '2026-09-06T09:00:00+02:00' };
    const nowMs = Date.parse('2026-09-01T00:00:00Z');
    // A different IANA zone must not change the resolved instant.
    const next = computeReminderNextFireAtMs(recurrence, 'America/New_York', nowMs);
    expect(next).toBe(Date.parse('2026-09-06T07:00:00Z'));
  });

  it('daily: computes the next occurrence at the given time', () => {
    const recurrence: ReminderRecurrence = { kind: 'daily', time: '09:00' };
    const nowMs = Date.parse('2026-06-01T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'UTC', nowMs);
    expect(next).toBe(Date.parse('2026-06-01T09:00:00Z'));
  });

  it('weekdays: skips the weekend', () => {
    const recurrence: ReminderRecurrence = { kind: 'weekdays', time: '08:00' };
    // 2026-09-05 is a Saturday.
    const nowMs = Date.parse('2026-09-05T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'UTC', nowMs);
    expect(next).toBe(Date.parse('2026-09-07T08:00:00Z')); // Monday
  });

  it('weekly: lands on the requested ISO weekday', () => {
    // ISO weekday 3 = Wednesday.
    const recurrence: ReminderRecurrence = { kind: 'weekly', time: '10:00', weekday: 3 };
    const nowMs = Date.parse('2026-09-01T00:00:00Z'); // Tuesday
    const next = computeReminderNextFireAtMs(recurrence, 'UTC', nowMs);
    expect(next).toBe(Date.parse('2026-09-02T10:00:00Z')); // Wednesday
  });

  it('monthly: skips months shorter than the requested day', () => {
    const recurrence: ReminderRecurrence = { kind: 'monthly', time: '11:00', dayOfMonth: 31 };
    const nowMs = Date.parse('2026-04-05T00:00:00Z'); // April has 30 days
    const next = computeReminderNextFireAtMs(recurrence, 'UTC', nowMs);
    expect(next).toBeDefined();
    const nextDate = new Date(next!);
    expect(nextDate.getUTCDate()).toBe(31);
    // The next month with a 31st after April 5 is May.
    expect(nextDate.getUTCMonth()).toBe(4); // 0-indexed: May
  });

  it('daily: crosses the Europe/Berlin spring-forward boundary (CET -> CEST)', () => {
    // DST begins 2026-03-29 at 02:00 CET -> 03:00 CEST.
    const recurrence: ReminderRecurrence = { kind: 'daily', time: '09:00' };
    const nowMs = Date.parse('2026-03-29T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'Europe/Berlin', nowMs);
    // 09:00 local on the transition day is already CEST (UTC+2).
    expect(next).toBe(Date.parse('2026-03-29T07:00:00Z'));
  });

  it('daily: crosses the Europe/Berlin fall-back boundary (CEST -> CET)', () => {
    // DST ends 2026-10-25 at 03:00 CEST -> 02:00 CET.
    const recurrence: ReminderRecurrence = { kind: 'daily', time: '09:00' };
    const nowMs = Date.parse('2026-10-25T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'Europe/Berlin', nowMs);
    // 09:00 local on the transition day is already back to CET (UTC+1).
    expect(next).toBe(Date.parse('2026-10-25T08:00:00Z'));
  });

  it('daily: crosses the America/New_York spring-forward boundary (EST -> EDT)', () => {
    // DST begins 2026-03-08 at 02:00 EST -> 03:00 EDT.
    const recurrence: ReminderRecurrence = { kind: 'daily', time: '09:00' };
    const nowMs = Date.parse('2026-03-08T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'America/New_York', nowMs);
    // 09:00 local on the transition day is already EDT (UTC-4).
    expect(next).toBe(Date.parse('2026-03-08T13:00:00Z'));
  });

  it('daily: crosses the America/New_York fall-back boundary (EDT -> EST)', () => {
    // DST ends 2026-11-01 at 02:00 EDT -> 01:00 EST.
    const recurrence: ReminderRecurrence = { kind: 'daily', time: '09:00' };
    const nowMs = Date.parse('2026-11-01T00:00:00Z');
    const next = computeReminderNextFireAtMs(recurrence, 'America/New_York', nowMs);
    // 09:00 local on the transition day is already back to EST (UTC-5).
    expect(next).toBe(Date.parse('2026-11-01T14:00:00Z'));
  });

  it('weekly: computes correctly across a DST boundary in Europe/Berlin', () => {
    // 2026-03-29 (transition Sunday) is ISO weekday 7.
    const recurrence: ReminderRecurrence = { kind: 'weekly', time: '09:00', weekday: 7 };
    const nowMs = Date.parse('2026-03-25T00:00:00Z'); // Wednesday before
    const next = computeReminderNextFireAtMs(recurrence, 'Europe/Berlin', nowMs);
    expect(next).toBe(Date.parse('2026-03-29T07:00:00Z'));
  });
});
