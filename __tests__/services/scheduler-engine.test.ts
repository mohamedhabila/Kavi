// ---------------------------------------------------------------------------
// Scheduler Engine — enhanced tests
// ---------------------------------------------------------------------------

jest.mock('../../src/services/cron/schedule', () => ({
  computeNextRunAtMs: jest.fn(),
}));

jest.mock('../../src/services/events/bus', () => ({
  emitSchedulerEvent: jest.fn(),
  getRegisteredEventKeys: jest.fn().mockReturnValue([]),
}));
jest.mock('../../src/services/scheduler/persistence', () => ({
  flushSchedulerStorePersistenceNow: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/scheduler/runtimeReadiness', () => ({
  ensureSchedulerRuntimeReady: jest.fn().mockResolvedValue(undefined),
  setSchedulerRecoveryFailureNotifier: jest.fn(),
}));
jest.mock('../../src/services/scheduler/terminalReportProcessor', () => ({
  drainSchedulerTerminalReports: jest.fn().mockResolvedValue(undefined),
  setSchedulerTerminalReportNotifiers: jest.fn(),
}));
jest.mock('../../src/services/startupRecovery', () => ({
  waitForPersistedAgentRecoveryReadiness: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/scheduler/store', () => {
  const jobs: any[] = [];
  const state = {
    get jobs() {
      return jobs;
    },
    terminalReports: [],
    getEnabledJobs: () => jobs.filter((j: any) => j.enabled),
    getJob: (id: string) => jobs.find((j: any) => j.id === id),
    tryClaimJobAttempt: jest.fn(({ id, attemptId, timestamp, force }: any) => {
      const index = jobs.findIndex((job: any) => job.id === id);
      const job = jobs[index];
      const nextRunAtMs =
        job?.nextRunAtMs ??
        require('../../src/services/cron/schedule').computeNextRunAtMs(job?.schedule, timestamp);
      if (
        !job ||
        job.runningAttemptId ||
        (!force && (!job.enabled || nextRunAtMs === undefined || nextRunAtMs > timestamp))
      ) {
        return undefined;
      }
      const claimedJob = {
        ...job,
        runningAttemptId: attemptId,
        runningStartedAtMs: timestamp,
      };
      jobs[index] = claimedJob;
      return { job: claimedJob, attempt: (job.retryAttempts || 0) + 1 };
    }),
    recordRun: jest.fn().mockReturnValue(true),
    recordRunFailure: jest.fn().mockReturnValue(true),
    restoreJobAttemptClaim: jest.fn(),
    resetJobRetry: jest.fn(),
    updateJobRuntimeState: jest.fn(),
  };
  return {
    useSchedulerStore: {
      getState: () => state,
    },
    __addJob: (job: any) => jobs.push(job),
    __clearJobs: () => {
      jobs.length = 0;
      state.tryClaimJobAttempt.mockClear();
      state.recordRun.mockClear();
      state.recordRunFailure.mockClear();
      state.resetJobRetry.mockClear();
      state.updateJobRuntimeState.mockClear();
    },
  };
});

import { computeNextRunAtMs } from '../../src/services/cron/schedule';
import { emitSchedulerEvent } from '../../src/services/events/bus';
import { AppState } from 'react-native';
import { resetSchedulerOperationLockForTests } from '../../src/services/scheduler/operationLock';
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
    (AppState as any).currentState = 'active';
    jest.clearAllMocks();
    jest.useFakeTimers();
    storeMock.__clearJobs();
    resetSchedulerOperationLockForTests();
    setSchedulerExecutor(null);
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
    jest.useRealTimers();
  });

  it('startScheduler / stopScheduler work without error', async () => {
    await startScheduler();
    stopScheduler();
  });

  it('startScheduler is idempotent', async () => {
    await Promise.all([startScheduler(), startScheduler()]);
    stopScheduler();
  });

  it('unrefs the scheduler interval when supported', async () => {
    const unref = jest.fn();
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as any);

    await startScheduler();

    expect(unref).toHaveBeenCalledTimes(1);

    stopScheduler();
    setIntervalSpy.mockRestore();
  });

  it('setSchedulerExecutor configures executor', async () => {
    const executor = { execute: jest.fn().mockResolvedValue({ output: 'done' }) };
    setSchedulerExecutor(executor);

    storeMock.__addJob({
      id: 'j2',
      name: 'TestJob',
      enabled: true,
      schedule: { kind: 'cron', expr: '* * * * *' },
    });

    // computeNext returns something indicating it should run (within check interval)
    mockComputeNext.mockReturnValue(Date.now() - 1000);

    await startScheduler();
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

    await startScheduler();
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockEmit).toHaveBeenCalledWith('task_failed', expect.objectContaining({ taskId: 'j3' }));
  });

  it('evaluateJobs marks retryable executor errors as retrying', async () => {
    const executor = { execute: jest.fn().mockRejectedValue(new Error('boom')) };
    setSchedulerExecutor(executor);

    storeMock.__addJob({
      id: 'j4',
      name: 'FailJob',
      enabled: true,
      schedule: { kind: 'cron', expr: '* * * * *' },
    });
    mockComputeNext.mockReturnValue(Date.now() - 1000);

    await startScheduler();
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockEmit).toHaveBeenCalledWith(
      'task_retrying',
      expect.objectContaining({ error: expect.stringContaining('boom') }),
    );
  });

  it('evaluateJobs skips jobs with no next run', async () => {
    const executor = { execute: jest.fn().mockResolvedValue({ output: 'done' }) };
    setSchedulerExecutor(executor);

    storeMock.__addJob({
      id: 'j5',
      name: 'SkipJob',
      enabled: true,
      schedule: { kind: 'at' },
    });
    mockComputeNext.mockReturnValue(undefined);

    await startScheduler();
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();

    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('evaluateJobs skips future jobs', async () => {
    const executor = { execute: jest.fn().mockResolvedValue({ output: 'done' }) };
    setSchedulerExecutor(executor);

    storeMock.__addJob({
      id: 'j6',
      name: 'FutureJob',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60000 },
    });
    mockComputeNext.mockReturnValue(Date.now() + 999999);

    await startScheduler();
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();

    expect(executor.execute).not.toHaveBeenCalled();
  });
});
