import { parseReminderWhen, resolveReminderTimezone } from '../../src/services/scheduler/reminders/input';

describe('parseReminderWhen: kind "once"', () => {
  it('accepts an "at" with an explicit UTC offset unchanged', () => {
    const result = parseReminderWhen({ kind: 'once', at: '2026-09-10T14:00:00-04:00' });
    expect(result).toEqual({ ok: true, recurrence: { kind: 'once', at: '2026-09-10T14:00:00-04:00' } });
  });

  it('accepts an "at" carrying "Z" unchanged', () => {
    const result = parseReminderWhen({ kind: 'once', at: '2026-09-10T14:00:00Z' });
    expect(result).toEqual({ ok: true, recurrence: { kind: 'once', at: '2026-09-10T14:00:00Z' } });
  });

  it('accepts an offset-less local date-time as a structurally valid "at"', () => {
    const result = parseReminderWhen({ kind: 'once', at: '2026-09-06T09:00:00' });
    expect(result).toEqual({ ok: true, recurrence: { kind: 'once', at: '2026-09-06T09:00:00' } });
  });

  it('accepts an offset-less local date-time without seconds', () => {
    const result = parseReminderWhen({ kind: 'once', at: '2026-09-06T09:00' });
    expect(result).toEqual({ ok: true, recurrence: { kind: 'once', at: '2026-09-06T09:00' } });
  });

  it('reports "when.at" as missing, not invalid, when absent', () => {
    const result = parseReminderWhen({ kind: 'once' });
    expect(result).toMatchObject({ ok: false, missingFields: ['when.at'], invalidFields: [] });
  });

  it('reports "when.at" as missing, not invalid, when an empty string', () => {
    const result = parseReminderWhen({ kind: 'once', at: '   ' });
    expect(result).toMatchObject({ ok: false, missingFields: ['when.at'], invalidFields: [] });
  });

  it('reports a non-string "when.at" as invalid, not missing (a value was actually supplied)', () => {
    const result = parseReminderWhen({ kind: 'once', at: 1234567890 });
    expect(result).toMatchObject({ ok: false, missingFields: [], invalidFields: ['when.at'] });
  });

  it('reports an unparsable "when.at" as invalid, not missing, and names the expected format', () => {
    const result = parseReminderWhen({ kind: 'once', at: 'next tuesday at noon' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.missingFields).toEqual([]);
    expect(result.invalidFields).toEqual(['when.at']);
    expect(result.error).toMatch(/ISO-8601/);
    expect(result.error).toMatch(/timezone/);
  });

  it('reports a syntactically-offset-shaped but unparsable "when.at" as invalid', () => {
    const result = parseReminderWhen({ kind: 'once', at: 'garbage-not-a-dateZ' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.missingFields).toEqual([]);
    expect(result.invalidFields).toEqual(['when.at']);
  });

  it('reports a calendar-invalid offset-less "when.at" (Feb 30) as invalid', () => {
    const result = parseReminderWhen({ kind: 'once', at: '2026-02-30T09:00:00' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.invalidFields).toEqual(['when.at']);
  });
});

describe('parseReminderWhen: truthful repair fields for other kinds', () => {
  it('"when" absent is missing', () => {
    const result = parseReminderWhen(undefined);
    expect(result).toMatchObject({ ok: false, missingFields: ['when'], invalidFields: [] });
  });

  it('"when" present but not an object is invalid, not missing', () => {
    const result = parseReminderWhen('tomorrow');
    expect(result).toMatchObject({ ok: false, missingFields: [], invalidFields: ['when'] });
  });

  it('"when.kind" absent is missing', () => {
    const result = parseReminderWhen({});
    expect(result).toMatchObject({ ok: false, missingFields: ['when.kind'], invalidFields: [] });
  });

  it('"when.kind" present but unrecognized is invalid, not missing', () => {
    const result = parseReminderWhen({ kind: 'yearly' });
    expect(result).toMatchObject({ ok: false, missingFields: [], invalidFields: ['when.kind'] });
  });

  it('"when.time" absent is missing', () => {
    const result = parseReminderWhen({ kind: 'daily' });
    expect(result).toMatchObject({ ok: false, missingFields: ['when.time'], invalidFields: [] });
  });

  it('"when.time" present but malformed is invalid, not missing', () => {
    const result = parseReminderWhen({ kind: 'daily', time: '9:00' });
    expect(result).toMatchObject({ ok: false, missingFields: [], invalidFields: ['when.time'] });
  });

  it('"when.weekday" absent is missing', () => {
    const result = parseReminderWhen({ kind: 'weekly', time: '09:00' });
    expect(result).toMatchObject({ ok: false, missingFields: ['when.weekday'], invalidFields: [] });
  });

  it('"when.weekday" present but out of range is invalid, not missing', () => {
    const result = parseReminderWhen({ kind: 'weekly', time: '09:00', weekday: 9 });
    expect(result).toMatchObject({ ok: false, missingFields: [], invalidFields: ['when.weekday'] });
  });

  it('"when.dayOfMonth" absent is missing', () => {
    const result = parseReminderWhen({ kind: 'monthly', time: '09:00' });
    expect(result).toMatchObject({ ok: false, missingFields: ['when.dayOfMonth'], invalidFields: [] });
  });

  it('"when.dayOfMonth" present but out of range is invalid, not missing', () => {
    const result = parseReminderWhen({ kind: 'monthly', time: '09:00', dayOfMonth: 32 });
    expect(result).toMatchObject({ ok: false, missingFields: [], invalidFields: ['when.dayOfMonth'] });
  });
});

describe('resolveReminderTimezone', () => {
  it('accepts a valid IANA zone', () => {
    expect(resolveReminderTimezone('Europe/Amsterdam')).toEqual({ ok: true, timezone: 'Europe/Amsterdam' });
  });

  it('defaults to the device zone when absent, never failing', () => {
    const result = resolveReminderTimezone(undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('reports an unrecognized zone as invalid, not missing', () => {
    const result = resolveReminderTimezone('Not/AZone');
    expect(result).toMatchObject({ ok: false, missingFields: [], invalidFields: ['timezone'] });
  });
});
