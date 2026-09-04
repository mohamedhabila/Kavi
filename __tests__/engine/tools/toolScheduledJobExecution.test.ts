jest.mock('../../../src/services/scheduler/commands', () => ({
  createScheduledJob: jest.fn(),
  listScheduledJobs: jest.fn().mockResolvedValue([]),
}));

import { createScheduledJob } from '../../../src/services/scheduler/commands';
import {
  executeCreateTask,
  normalizeCronScheduleArg,
} from '../../../src/engine/tools/toolScheduledJobExecution';

function parse(content: string): any {
  return JSON.parse(content);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeCronScheduleArg', () => {
  it('treats a bare string as a legacy cron expression and echoes it verbatim', () => {
    const result = normalizeCronScheduleArg('0 8 * * *', '');
    expect(result).toEqual({
      ok: true,
      schedule: { kind: 'cron', expr: '0 8 * * *' },
      echo: '0 8 * * *',
    });
  });

  it('applies an outer timezone to a legacy string schedule', () => {
    const result = normalizeCronScheduleArg('0 8 * * *', 'Europe/Berlin');
    expect(result).toEqual({
      ok: true,
      schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'Europe/Berlin' },
      echo: '0 8 * * *',
    });
  });

  it('rejects an empty string', () => {
    expect(normalizeCronScheduleArg('   ', '')).toEqual({ ok: false, error: expect.any(String) });
  });

  it('accepts a structured cron object', () => {
    const result = normalizeCronScheduleArg({ kind: 'cron', expr: '*/5 * * * *' }, '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schedule).toEqual({ kind: 'cron', expr: '*/5 * * * *' });
      expect(result.echo).toEqual(result.schedule);
    }
  });

  it('accepts a structured "at" object', () => {
    const result = normalizeCronScheduleArg({ kind: 'at', at: '2099-01-01T00:00:00Z' }, '');
    expect(result).toEqual({
      ok: true,
      schedule: { kind: 'at', at: '2099-01-01T00:00:00Z' },
      echo: { kind: 'at', at: '2099-01-01T00:00:00Z' },
    });
  });

  it('accepts a structured "every" object and converts seconds to everyMs', () => {
    const result = normalizeCronScheduleArg({ kind: 'every', seconds: 30 }, '');
    expect(result).toEqual({
      ok: true,
      schedule: { kind: 'every', everyMs: 30_000 },
      echo: { kind: 'every', everyMs: 30_000 },
    });
  });

  it('rejects an "at" object missing "at"', () => {
    expect(normalizeCronScheduleArg({ kind: 'at' }, '').ok).toBe(false);
  });

  it('rejects an "every" object with a non-positive seconds value', () => {
    expect(normalizeCronScheduleArg({ kind: 'every', seconds: 0 }, '').ok).toBe(false);
    expect(normalizeCronScheduleArg({ kind: 'every', seconds: -5 }, '').ok).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(normalizeCronScheduleArg({ kind: 'weird' }, '').ok).toBe(false);
  });

  it('rejects a missing schedule', () => {
    expect(normalizeCronScheduleArg(undefined, '').ok).toBe(false);
    expect(normalizeCronScheduleArg(null, '').ok).toBe(false);
  });
});

describe('executeCreateTask', () => {
  it('still echoes the exact legacy string schedule for backward compatibility', async () => {
    (createScheduledJob as jest.Mock).mockResolvedValue({ id: 'job-1' });
    const result = await executeCreateTask({ schedule: '0 8 * * *', prompt: 'Daily reminder' });
    expect(result.status).toBe('completed');
    const parsed = parse(result.content);
    expect(parsed.status).toBe('task_created');
    expect(parsed.schedule).toBe('0 8 * * *');
    expect(createScheduledJob).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: { kind: 'cron', expr: '0 8 * * *' } }),
    );
  });

  it('creates a one-shot "at" job from a structured schedule', async () => {
    (createScheduledJob as jest.Mock).mockResolvedValue({ id: 'job-2' });
    const result = await executeCreateTask({
      schedule: { kind: 'at', at: '2099-01-01T00:00:00Z' },
      prompt: 'Once',
    });
    expect(result.status).toBe('completed');
    const parsed = parse(result.content);
    expect(parsed.schedule).toEqual({ kind: 'at', at: '2099-01-01T00:00:00Z' });
    expect(createScheduledJob).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: { kind: 'at', at: '2099-01-01T00:00:00Z' } }),
    );
  });

  it('rejects an invalid structured schedule', async () => {
    const result = await executeCreateTask({ schedule: { kind: 'every', seconds: -1 }, prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(parse(result.content).code).toBe('invalid_scheduled_job');
    expect(createScheduledJob).not.toHaveBeenCalled();
  });

  it('requires both schedule and prompt', async () => {
    const result = await executeCreateTask({});
    expect(result.status).toBe('failed');
    expect(parse(result.content).repair.missingFields).toEqual(['schedule', 'prompt']);
  });
});
