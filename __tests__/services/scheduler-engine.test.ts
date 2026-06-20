// ---------------------------------------------------------------------------
// Scheduler Engine — enhanced tests
// ---------------------------------------------------------------------------

jest.mock('../../src/services/cron/schedule', () => ({
  computeNextRunAtMs: jest.fn(),
}));

jest.mock('../../src/services/events/bus', () => ({
  emitSchedulerEvent: jest.fn(),
}));

jest.mock('../../src/services/scheduler/store', () => {
  const jobs: any[] = [];
  const state = {
    get jobs() {
      return jobs;
    },
    getEnabledJobs: () => jobs.filter((j: any) => j.enabled),
    getJob: (id: string) => jobs.find((j: any) => j.id === id),
    markJobAttemptStarted: jest.fn(),
    recordRun: jest.fn(),
    recordRunFailure: jest.fn(),
    resetJobRetry: jest.fn(),
    updateJobRuntimeState: jest.fn(),
    recordEvaluation: jest.fn(),
  };
  return {
    useSchedulerStore: {
      getState: () => state,
    },
    __addJob: (job: any) => jobs.push(job),
    __clearJobs: () => {
      jobs.length = 0;
      state.markJobAttemptStarted.mockClear();
      state.recordRun.mockClear();
      state.recordRunFailure.mockClear();
      state.resetJobRetry.mockClear();
      state.updateJobRuntimeState.mockClear();
      state.recordEvaluation.mockClear();
    },
  };
});

import { computeNextRunAtMs } from '../../src/services/cron/schedule';
import { emitSchedulerEvent } from '../../src/services/events/bus';
import {
  startScheduler,
  stopScheduler,
  setSchedulerExecutor,
} from '../../src/services/scheduler/engine';

const mockComputeNext = computeNextRunAtMs as jest.Mock;
const mockEmit = emitSchedulerEvent as jest.Mock;
const storeMock = require('../../src/services/scheduler/store');

describe('Scheduler Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    storeMock.__clearJobs();
    setSchedulerExecutor(null);
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
    jest.useRealTimers();
  });

  it('startScheduler / stopScheduler work without error', () => {
    startScheduler();
    stopScheduler();
  });

  it('startScheduler is idempotent', () => {
    startScheduler();
    startScheduler(); // Second call should be no-op
    stopScheduler();
  });

  it('unrefs the scheduler interval when supported', () => {
    const unref = jest.fn();
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as any);

    startScheduler();

    expect(unref).toHaveBeenCalledTimes(1);

    stopScheduler();
    setIntervalSpy.mockRestore();
  });

  it('setSchedulerExecutor configures executor', async () => {
    const executor = { execute: jest.fn().mockResolvedValue('done') };
    setSchedulerExecutor(executor);

    storeMock.__addJob({
      id: 'j2',
      name: 'TestJob',
      enabled: true,
      schedule: { kind: 'cron', expr: '* * * * *' },
    });

    // computeNext returns something indicating it should run (within check interval)
    mockComputeNext.mockReturnValue(Date.now() - 1000);

    startScheduler();
    // The initial evaluateJobs() is called immediately
    await Promise.resolve(); // flush microtasks

    // Give the async evaluateJobs time to resolve
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();

    // Executor should have been called
    expect(executor.execute).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith('task_run', expect.any(Object));
  });

  it('evaluateJobs emits error when no executor', async () => {
    setSchedulerExecutor(null as any);

    storeMock.__addJob({
      id: 'j3',
      name: 'TestJob2',
      enabled: true,
      schedule: { kind: 'cron', expr: '* * * * *' },
    });
    mockComputeNext.mockReturnValue(Date.now() - 1000);

    startScheduler();
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockEmit).toHaveBeenCalledWith('task_failed', expect.objectContaining({ taskId: 'j3' }));
  });

  it('evaluateJobs handles executor errors', async () => {
    const executor = { execute: jest.fn().mockRejectedValue(new Error('boom')) };
    setSchedulerExecutor(executor);

    storeMock.__addJob({
      id: 'j4',
      name: 'FailJob',
      enabled: true,
      schedule: { kind: 'cron', expr: '* * * * *' },
    });
    mockComputeNext.mockReturnValue(Date.now() - 1000);

    startScheduler();
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockEmit).toHaveBeenCalledWith(
      'task_failed',
      expect.objectContaining({ error: expect.stringContaining('boom') }),
    );
  });

  it('evaluateJobs skips jobs with no next run', async () => {
    const executor = { execute: jest.fn().mockResolvedValue('done') };
    setSchedulerExecutor(executor);

    storeMock.__addJob({
      id: 'j5',
      name: 'SkipJob',
      enabled: true,
      schedule: { kind: 'at' },
    });
    mockComputeNext.mockReturnValue(undefined);

    startScheduler();
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();

    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('evaluateJobs skips future jobs', async () => {
    const executor = { execute: jest.fn().mockResolvedValue('done') };
    setSchedulerExecutor(executor);

    storeMock.__addJob({
      id: 'j6',
      name: 'FutureJob',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60000 },
    });
    mockComputeNext.mockReturnValue(Date.now() + 999999);

    startScheduler();
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();

    expect(executor.execute).not.toHaveBeenCalled();
  });
});
