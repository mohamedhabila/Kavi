// ---------------------------------------------------------------------------
// Tests — Cron Parse & Schedule
// ---------------------------------------------------------------------------

import { parseAbsoluteTimeMs } from '../../src/services/cron/parse';
import {
  computeNextRunAtMs,
  coerceFiniteScheduleNumber,
  clearCronScheduleCacheForTest,
} from '../../src/services/cron/schedule';
import type { CronSchedule } from '../../src/services/cron/types';

beforeEach(() => {
  clearCronScheduleCacheForTest();
});

describe('parseAbsoluteTimeMs', () => {
  it('returns null for empty string', () => {
    expect(parseAbsoluteTimeMs('')).toBeNull();
  });

  it('parses Unix ms timestamp', () => {
    expect(parseAbsoluteTimeMs('1700000000000')).toBe(1700000000000);
  });

  it('parses ISO date string', () => {
    const result = parseAbsoluteTimeMs('2024-01-15');
    expect(result).toBe(Date.parse('2024-01-15T00:00:00Z'));
  });

  it('parses ISO datetime string', () => {
    const result = parseAbsoluteTimeMs('2024-01-15T10:30:00');
    expect(result).toBe(Date.parse('2024-01-15T10:30:00Z'));
  });

  it('parses ISO with timezone', () => {
    const result = parseAbsoluteTimeMs('2024-01-15T10:30:00+05:00');
    expect(result).toBe(Date.parse('2024-01-15T10:30:00+05:00'));
  });

  it('returns null for invalid input', () => {
    expect(parseAbsoluteTimeMs('not a date')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseAbsoluteTimeMs('abc')).toBeNull();
  });
});

describe('coerceFiniteScheduleNumber', () => {
  it('returns number for finite number', () => {
    expect(coerceFiniteScheduleNumber(42)).toBe(42);
  });

  it('returns undefined for NaN', () => {
    expect(coerceFiniteScheduleNumber(NaN)).toBeUndefined();
  });

  it('returns undefined for Infinity', () => {
    expect(coerceFiniteScheduleNumber(Infinity)).toBeUndefined();
  });

  it('parses string number', () => {
    expect(coerceFiniteScheduleNumber('123')).toBe(123);
  });

  it('returns undefined for empty string', () => {
    expect(coerceFiniteScheduleNumber('')).toBeUndefined();
  });

  it('returns undefined for non-number types', () => {
    expect(coerceFiniteScheduleNumber(null)).toBeUndefined();
    expect(coerceFiniteScheduleNumber(undefined)).toBeUndefined();
    expect(coerceFiniteScheduleNumber({})).toBeUndefined();
  });
});

describe('computeNextRunAtMs', () => {
  const now = 1700000000000;

  describe('kind: at', () => {
    it('returns future atMs', () => {
      const schedule: CronSchedule = { kind: 'at', atMs: now + 60000 } as any;
      expect(computeNextRunAtMs(schedule, now)).toBe(now + 60000);
    });

    it('returns undefined for past atMs', () => {
      const schedule: CronSchedule = { kind: 'at', atMs: now - 60000 } as any;
      expect(computeNextRunAtMs(schedule, now)).toBeUndefined();
    });

    it('parses string at', () => {
      const schedule: CronSchedule = { kind: 'at', at: '2099-01-01' } as any;
      const result = computeNextRunAtMs(schedule, now);
      expect(result).toBeGreaterThan(now);
    });
  });

  describe('kind: every', () => {
    it('computes next interval', () => {
      const schedule: CronSchedule = { kind: 'every', everyMs: 60000 };
      const result = computeNextRunAtMs(schedule, now);
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(now);
    });

    it('returns undefined for invalid everyMs', () => {
      const schedule: CronSchedule = { kind: 'every', everyMs: NaN as any };
      expect(computeNextRunAtMs(schedule, now)).toBeUndefined();
    });

    it('uses anchorMs when provided', () => {
      const schedule: CronSchedule = { kind: 'every', everyMs: 60000, anchorMs: now - 30000 };
      const result = computeNextRunAtMs(schedule, now);
      expect(result).toBeDefined();
      expect(result! - now).toBeLessThanOrEqual(60000);
    });
  });

  describe('kind: cron', () => {
    it('computes next cron run', () => {
      const schedule: CronSchedule = { kind: 'cron', expr: '* * * * *' };
      const result = computeNextRunAtMs(schedule, now);
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(now);
    });

    it('returns undefined for invalid expression', () => {
      const schedule: CronSchedule = { kind: 'cron', expr: '' };
      expect(computeNextRunAtMs(schedule, now)).toBeUndefined();
    });
  });
});
