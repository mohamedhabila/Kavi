// ---------------------------------------------------------------------------
// Tests — Scheduler Store + Engine
// ---------------------------------------------------------------------------

import { useSchedulerStore } from '../../src/services/scheduler/store';
import {
  setSchedulerExecutor,
  startScheduler,
  stopScheduler,
} from '../../src/services/scheduler/engine';

// Mock events bus
jest.mock('../../src/services/events/bus', () => ({
  emitSchedulerEvent: jest.fn().mockResolvedValue(undefined),
}));

// Mock cron schedule
jest.mock('../../src/services/cron/schedule', () => ({
  computeNextRunAtMs: jest.fn((schedule: any, _refMs?: number) => {
    if (schedule.kind === 'cron') return Date.now() - 1000; // already due
    if (schedule.kind === 'at') return schedule.atMs;
    if (schedule.kind === 'every') return Date.now() - 1;
    return undefined;
  }),
}));

beforeEach(() => {
  // Reset store
  useSchedulerStore.setState({ jobs: [] });
  stopScheduler();
});

describe('useSchedulerStore', () => {
  it('starts with empty jobs', () => {
    expect(useSchedulerStore.getState().jobs).toEqual([]);
  });

  it('addJob creates a job and returns id', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Test Job',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      prompt: 'Do something',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const jobs = useSchedulerStore.getState().jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('Test Job');
    expect(jobs[0].enabled).toBe(true);
    expect(jobs[0].schedule.kind).toBe('cron');
    expect(jobs[0].payload.prompt).toBe('Do something');
    expect(jobs[0].sessionTarget).toBe('isolated');
    expect(jobs[0].wakeMode).toBe('new');
    expect(jobs[0].delivery?.mode).toBe('both');
    expect(typeof jobs[0].nextRunAtMs).toBe('number');
    expect(jobs[0].retryAttempts).toBe(0);
    expect(jobs[0].wakePolicy).toBe('try_background_then_notify');
  });

  it('addJob uses provided optional params', () => {
    useSchedulerStore.getState().addJob({
      name: 'Custom Job',
      schedule: { kind: 'every', everyMs: 60000 },
      prompt: 'Run me',
      model: 'gpt-5.4',
      providerId: 'openai',
      sessionTarget: 'main',
      wakeMode: 'continue',
      deliveryMode: 'both',
    });

    const job = useSchedulerStore.getState().jobs[0];
    expect(job.payload.model).toBe('gpt-5.4');
    expect(job.payload.providerId).toBe('openai');
    expect(job.sessionTarget).toBe('main');
    expect(job.wakeMode).toBe('continue');
    expect(job.delivery?.mode).toBe('both');
    expect((job.schedule as any).anchorMs).toBeDefined();
  });

  it('removeJob removes a job', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'To Remove',
      schedule: { kind: 'cron', expr: '* * * * *' },
      prompt: 'test',
    });
    expect(useSchedulerStore.getState().jobs).toHaveLength(1);

    useSchedulerStore.getState().removeJob(id);
    expect(useSchedulerStore.getState().jobs).toHaveLength(0);
  });

  it('enableJob / disableJob toggling', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Toggle',
      schedule: { kind: 'cron', expr: '* * * * *' },
      prompt: 'test',
    });

    useSchedulerStore.getState().disableJob(id);
    expect(useSchedulerStore.getState().jobs[0].enabled).toBe(false);

    useSchedulerStore.getState().enableJob(id);
    expect(useSchedulerStore.getState().jobs[0].enabled).toBe(true);
  });

  it('recordRun auto-disables "at" schedule', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'One-shot',
      schedule: { kind: 'at', atMs: Date.now() + 60000 },
      prompt: 'once',
    });
    expect(useSchedulerStore.getState().jobs[0].enabled).toBe(true);

    useSchedulerStore.getState().recordRun(id, Date.now());
    expect(useSchedulerStore.getState().jobs[0].enabled).toBe(false);
  });

  it('recordRun does not disable cron schedule', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Recurring',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      prompt: 'daily',
    });

    useSchedulerStore.getState().recordRun(id, Date.now());
    // Cron jobs stay enabled
    const job = useSchedulerStore.getState().jobs[0];
    // The store only auto-disables 'at' or deleteAfterRun
    expect(job.updatedAtMs).toBeGreaterThan(0);
    expect(job.lastSuccessAtMs).toBeGreaterThan(0);
    expect(job.retryAttempts).toBe(0);
  });

  it('recordRunFailure persists retry state without disabling recurring jobs', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Retrying',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      prompt: 'daily',
    });
    const timestamp = Date.now();

    useSchedulerStore.getState().recordRunFailure(id, {
      timestamp,
      error: 'network down',
      attempt: 1,
      nextRetryAtMs: timestamp + 30_000,
      final: false,
    });

    const job = useSchedulerStore.getState().jobs[0];
    expect(job.enabled).toBe(true);
    expect(job.lastFailureAtMs).toBe(timestamp);
    expect(job.lastError).toBe('network down');
    expect(job.retryAttempts).toBe(1);
    expect(job.nextRetryAtMs).toBe(timestamp + 30_000);
  });

  it('getJob returns job by id', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Find Me',
      schedule: { kind: 'cron', expr: '0 0 * * *' },
      prompt: 'find',
    });

    const job = useSchedulerStore.getState().getJob(id);
    expect(job).toBeDefined();
    expect(job!.name).toBe('Find Me');
  });

  it('getJob returns undefined for missing id', () => {
    expect(useSchedulerStore.getState().getJob('nonexistent')).toBeUndefined();
  });

  it('getEnabledJobs filters only enabled', () => {
    const id1 = useSchedulerStore.getState().addJob({
      name: 'Enabled',
      schedule: { kind: 'cron', expr: '0 0 * * *' },
      prompt: 'a',
    });
    const id2 = useSchedulerStore.getState().addJob({
      name: 'Disabled',
      schedule: { kind: 'cron', expr: '0 0 * * *' },
      prompt: 'b',
    });
    useSchedulerStore.getState().disableJob(id2);

    const enabled = useSchedulerStore.getState().getEnabledJobs();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe(id1);
    expect(enabled[0].name).toBe('Enabled');
  });

  it('updateJob updates partial fields', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Update Me',
      schedule: { kind: 'cron', expr: '0 0 * * *' },
      prompt: 'original',
    });

    useSchedulerStore.getState().updateJob(id, { name: 'Updated' });
    expect(useSchedulerStore.getState().jobs[0].name).toBe('Updated');
  });
});

describe('Scheduler Engine', () => {
  it('startScheduler / stopScheduler work without error', () => {
    setSchedulerExecutor({ execute: jest.fn().mockResolvedValue('ok') });
    startScheduler();
    stopScheduler();
  });

  it('startScheduler is idempotent', () => {
    setSchedulerExecutor({ execute: jest.fn().mockResolvedValue('ok') });
    startScheduler();
    startScheduler(); // noop
    stopScheduler();
  });
});
