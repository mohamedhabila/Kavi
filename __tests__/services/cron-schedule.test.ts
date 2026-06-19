// ---------------------------------------------------------------------------
// Cron Schedule — tests
// ---------------------------------------------------------------------------

jest.mock('croner', () => {
  return {
    Cron: jest.fn().mockImplementation((_expr: string, _opts: any) => {
      return {
        nextRun: jest.fn((date: Date) => {
          // Simple mock: return 1 minute after the given date for standard cron
          return new Date(date.getTime() + 60000);
        }),
        previousRuns: jest.fn((_count: number, date: Date) => {
          return [new Date(date.getTime() - 60000)];
        }),
      };
    }),
  };
});

import {
  coerceFiniteScheduleNumber,
  computeNextRunAtMs,
  clearCronScheduleCacheForTest,
} from '../../src/services/cron/schedule';
import type { CronSchedule } from '../../src/services/cron/types';

describe('coerceFiniteScheduleNumber', () => {
  it('returns number for finite number', () => {
    expect(coerceFiniteScheduleNumber(42)).toBe(42);
  });

  it('returns undefined for Infinity', () => {
    expect(coerceFiniteScheduleNumber(Infinity)).toBeUndefined();
  });

  it('returns undefined for NaN', () => {
    expect(coerceFiniteScheduleNumber(NaN)).toBeUndefined();
  });

  it('parses string to number', () => {
    expect(coerceFiniteScheduleNumber('123')).toBe(123);
  });

  it('returns undefined for empty string', () => {
    expect(coerceFiniteScheduleNumber('')).toBeUndefined();
  });

  it('returns undefined for non-numeric string', () => {
    expect(coerceFiniteScheduleNumber('abc')).toBeUndefined();
  });

  it('returns undefined for null/undefined/objects', () => {
    expect(coerceFiniteScheduleNumber(null)).toBeUndefined();
    expect(coerceFiniteScheduleNumber(undefined)).toBeUndefined();
    expect(coerceFiniteScheduleNumber({})).toBeUndefined();
  });

  it('handles whitespace-only strings', () => {
    expect(coerceFiniteScheduleNumber('  ')).toBeUndefined();
  });

  it('handles strings with whitespace around numbers', () => {
    expect(coerceFiniteScheduleNumber(' 42 ')).toBe(42);
  });
});

describe('computeNextRunAtMs — "at" schedule', () => {
  it('returns atMs when in the future', () => {
    const now = 1000;
    const schedule: CronSchedule = { kind: 'at', atMs: 2000 } as any;
    expect(computeNextRunAtMs(schedule, now)).toBe(2000);
  });

  it('returns undefined when atMs is in the past', () => {
    const now = 3000;
    const schedule: CronSchedule = { kind: 'at', atMs: 2000 } as any;
    expect(computeNextRunAtMs(schedule, now)).toBeUndefined();
  });

  it('parses string at field', () => {
    const futureDate = new Date(Date.now() + 100000).toISOString();
    const schedule: CronSchedule = { kind: 'at', at: futureDate } as any;
    const result = computeNextRunAtMs(schedule, Date.now());
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(Date.now() - 1000);
  });

  it('returns undefined for invalid at string', () => {
    const schedule: CronSchedule = { kind: 'at', at: 'not-a-date' } as any;
    expect(computeNextRunAtMs(schedule, Date.now())).toBeUndefined();
  });
});

describe('computeNextRunAtMs — "every" schedule', () => {
  it('returns next interval from anchor', () => {
    const now = 5000;
    const schedule: CronSchedule = { kind: 'every', everyMs: 2000 } as any;
    const result = computeNextRunAtMs(schedule, now);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(now);
  });

  it('returns anchor when now < anchor', () => {
    const now = 1000;
    const schedule: CronSchedule = { kind: 'every', everyMs: 2000, anchorMs: 5000 } as any;
    expect(computeNextRunAtMs(schedule, now)).toBe(5000);
  });

  it('returns undefined for non-finite everyMs', () => {
    const schedule: CronSchedule = { kind: 'every', everyMs: 'abc' } as any;
    expect(computeNextRunAtMs(schedule, 1000)).toBeUndefined();
  });

  it('handles string everyMs', () => {
    const now = 1000;
    const schedule: CronSchedule = { kind: 'every', everyMs: '3000' } as any;
    const result = computeNextRunAtMs(schedule, now);
    expect(result).toBeDefined();
  });
});

describe('computeNextRunAtMs — "cron" schedule', () => {
  beforeEach(() => {
    clearCronScheduleCacheForTest();
    jest.clearAllMocks();
  });

  it('returns next run from cron expression', () => {
    const now = Date.now();
    const schedule: CronSchedule = { kind: 'cron', expr: '*/5 * * * *' } as any;
    const result = computeNextRunAtMs(schedule, now);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(now);
  });

  it('throws for missing expr', () => {
    const schedule: CronSchedule = { kind: 'cron' } as any;
    expect(() => computeNextRunAtMs(schedule, Date.now())).toThrow('invalid cron schedule');
  });

  it('handles cron field alias', () => {
    const now = Date.now();
    const schedule: CronSchedule = { kind: 'cron', cron: '0 * * * *' } as any;
    const result = computeNextRunAtMs(schedule, now);
    expect(result).toBeDefined();
  });

  it('returns undefined for empty string expr', () => {
    const schedule: CronSchedule = { kind: 'cron', expr: '' } as any;
    expect(computeNextRunAtMs(schedule, Date.now())).toBeUndefined();
  });
});

describe('clearCronScheduleCacheForTest', () => {
  it('should clear cache without error', () => {
    clearCronScheduleCacheForTest();
    // No assertion needed, just verifying it doesn't throw
  });
});

describe('computeNextRunAtMs — cron edge cases (nextMs <= nowMs retry)', () => {
  beforeEach(() => {
    clearCronScheduleCacheForTest();
    jest.clearAllMocks();
  });

  it('retries when nextRun returns time <= nowMs', () => {
    const { Cron } = require('croner');
    const now = 100000;
    let callCount = 0;
    Cron.mockImplementationOnce(() => ({
      nextRun: jest.fn((date: Date) => {
        callCount++;
        if (callCount === 1) {
          // First call: return time in the past (triggers retry)
          return new Date(now - 1000);
        }
        // Subsequent calls: return time in the future
        return new Date(date.getTime() + 60000);
      }),
      previousRuns: jest.fn(() => []),
    }));

    const schedule: CronSchedule = { kind: 'cron', expr: '0 * * * *' } as any;
    const result = computeNextRunAtMs(schedule, now);
    // Should either find a future time or return undefined
    expect(result === undefined || result > now).toBe(true);
    expect(callCount).toBeGreaterThan(1);
  });

  it('returns undefined when all retries fail', () => {
    const { Cron } = require('croner');
    Cron.mockImplementationOnce(() => ({
      nextRun: jest.fn(() => new Date(0)), // Always returns past time
      previousRuns: jest.fn(() => []),
    }));

    const schedule: CronSchedule = { kind: 'cron', expr: '0 * * * *' } as any;
    const result = computeNextRunAtMs(schedule, 100000);
    expect(result).toBeUndefined();
  });

  it('returns undefined when nextRun returns null', () => {
    const { Cron } = require('croner');
    Cron.mockImplementationOnce(() => ({
      nextRun: jest.fn(() => null),
      previousRuns: jest.fn(() => []),
    }));

    const schedule: CronSchedule = { kind: 'cron', expr: '0 * * * *' } as any;
    const result = computeNextRunAtMs(schedule, 100000);
    expect(result).toBeUndefined();
  });

  it('handles non-finite nextMs', () => {
    const { Cron } = require('croner');
    Cron.mockImplementationOnce(() => ({
      nextRun: jest.fn(() => new Date(NaN)),
      previousRuns: jest.fn(() => []),
    }));

    const schedule: CronSchedule = { kind: 'cron', expr: '0 * * * *' } as any;
    const result = computeNextRunAtMs(schedule, 100000);
    expect(result).toBeUndefined();
  });
});
