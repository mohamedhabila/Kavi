import { shouldDisableAfterRun } from '../../src/services/scheduler/storeModel';
import type { CronJob } from '../../src/services/cron/types';

function baseJob(overrides: Partial<CronJob>): CronJob {
  return {
    id: 'job-1',
    definitionRevision: 1,
    name: 'Test job',
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    schedule: { kind: 'cron', expr: '* * * * *' },
    sessionTarget: 'isolated',
    wakeMode: 'new',
    payload: { prompt: 'do something', mode: 'agentic' },
    retryAttempts: 0,
    wakePolicy: 'notify_only',
    ...overrides,
  };
}

describe('shouldDisableAfterRun', () => {
  it('is true for a one-shot "at" schedule, without needing an explicit deleteAfterRun flag', () => {
    const job = baseJob({ schedule: { kind: 'at', at: '2026-01-01T00:00:00Z' } });
    expect(shouldDisableAfterRun(job)).toBe(true);
  });

  it('is true when deleteAfterRun is explicitly set, regardless of schedule kind', () => {
    const job = baseJob({
      schedule: { kind: 'cron', expr: '* * * * *' },
      deleteAfterRun: true,
    });
    expect(shouldDisableAfterRun(job)).toBe(true);
  });

  it('is false for a recurring cron schedule with no explicit deleteAfterRun', () => {
    const job = baseJob({ schedule: { kind: 'cron', expr: '* * * * *' } });
    expect(shouldDisableAfterRun(job)).toBe(false);
  });

  it('is false for a recurring "every" schedule', () => {
    const job = baseJob({ schedule: { kind: 'every', everyMs: 60_000 } });
    expect(shouldDisableAfterRun(job)).toBe(false);
  });
});
