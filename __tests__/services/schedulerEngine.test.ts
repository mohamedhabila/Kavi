// ---------------------------------------------------------------------------
// Tests — Scheduler Engine
// ---------------------------------------------------------------------------

import {
  evaluateJobsOnce,
  resetJobRetry,
  runJobNow,
  setSchedulerExecutor,
  startScheduler,
  stopScheduler,
} from '../../src/services/scheduler/engine';
import { useSchedulerStore } from '../../src/services/scheduler/store';
import { useExecutionTraceStore } from '../../src/services/scheduler/traceStore';

function resetStores() {
  useSchedulerStore.setState({ jobs: [], lastEvaluationAtMs: undefined });
  useExecutionTraceStore.setState({ traces: [] });
}

function setJobRuntime(id: string, updates: Record<string, unknown>) {
  useSchedulerStore.setState({
    jobs: useSchedulerStore
      .getState()
      .jobs.map((job) => (job.id === id ? { ...job, ...updates } : job)),
  });
}

function mockNow(timestamp: number) {
  return jest.spyOn(Date, 'now').mockReturnValue(timestamp);
}

describe('Scheduler Engine', () => {
  beforeEach(() => {
    stopScheduler();
    resetStores();
    setSchedulerExecutor(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    stopScheduler();
  });

  describe('startScheduler / stopScheduler', () => {
    it('starts and stops without error', () => {
      setSchedulerExecutor({ execute: async () => 'ok' });
      expect(() => startScheduler()).not.toThrow();
      expect(() => stopScheduler()).not.toThrow();
    });

    it('does not create multiple intervals on double start', () => {
      setSchedulerExecutor({ execute: async () => 'ok' });
      startScheduler();
      startScheduler();
      stopScheduler();
    });
  });

  describe('evaluateJobsOnce', () => {
    it('does not crash with empty job list', async () => {
      setSchedulerExecutor({ execute: async () => 'ok' });
      await expect(evaluateJobsOnce()).resolves.toBeUndefined();
    });

    it('records an error trace when no executor is configured for a due job', async () => {
      const now = 1_700_000_000_000;
      mockNow(now);

      const jobId = useSchedulerStore.getState().addJob({
        name: 'test-job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'Do something',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });

      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });

      const traces = useExecutionTraceStore.getState().traces;
      expect(traces).toHaveLength(1);
      expect(traces[0]).toMatchObject({
        jobId,
        status: 'error',
        error: 'No executor configured',
        trigger: 'scheduled',
      });
      expect(useSchedulerStore.getState().getJob(jobId)?.lastError).toBe('No executor configured');
    });

    it('executes a due job and persists success runtime state', async () => {
      const now = 1_700_000_100_000;
      mockNow(now);
      const executeFn = jest.fn().mockResolvedValue('done');
      setSchedulerExecutor({ execute: executeFn });

      const jobId = useSchedulerStore.getState().addJob({
        name: 'Due Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'Run this',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });

      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });

      expect(executeFn).toHaveBeenCalledTimes(1);
      const job = useSchedulerStore.getState().getJob(jobId);
      expect(job?.lastSuccessAtMs).toBe(now);
      expect(job?.lastError).toBeUndefined();
      expect(job?.retryAttempts).toBe(0);
      expect(job?.runningAttemptId).toBeUndefined();
      expect(job?.nextRunAtMs).toBe(now + 60_000);
      expect(useExecutionTraceStore.getState().traces[0]).toMatchObject({
        jobId,
        status: 'success',
        output: 'done',
        trigger: 'scheduled',
      });
    });

    it('persists retry cooldown and retries only after the cooldown expires', async () => {
      const now = 1_700_000_200_000;
      const nowSpy = mockNow(now);
      const executeFn = jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce('recovered');
      setSchedulerExecutor({ execute: executeFn });

      const jobId = useSchedulerStore.getState().addJob({
        name: 'Retry Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'retry',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });

      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });

      let job = useSchedulerStore.getState().getJob(jobId);
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(job?.retryAttempts).toBe(1);
      expect(job?.nextRetryAtMs).toBe(now + 30_000);
      expect(job?.lastError).toBe('temporary failure');

      nowSpy.mockReturnValue(now + 10_000);
      await evaluateJobsOnce({ nowMs: now + 10_000, trigger: 'scheduled' });
      expect(executeFn).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(now + 30_000);
      await evaluateJobsOnce({ nowMs: now + 30_000, trigger: 'scheduled' });

      job = useSchedulerStore.getState().getJob(jobId);
      expect(executeFn).toHaveBeenCalledTimes(2);
      expect(job?.retryAttempts).toBe(0);
      expect(job?.nextRetryAtMs).toBeUndefined();
      expect(job?.lastSuccessAtMs).toBe(now + 30_000);
      expect(useExecutionTraceStore.getState().traces.map((trace) => trace.status)).toEqual([
        'success',
        'retrying',
      ]);
    });

    it('recovers a missed run from persisted nextRunAtMs after a cold start', async () => {
      const now = 1_700_000_300_000;
      mockNow(now);
      const executeFn = jest.fn().mockResolvedValue('missed recovered');
      setSchedulerExecutor({ execute: executeFn });

      const jobId = useSchedulerStore.getState().addJob({
        name: 'Missed Job',
        schedule: { kind: 'every', everyMs: 300_000 },
        prompt: 'recover',
      });
      setJobRuntime(jobId, {
        nextRunAtMs: now - 300_000,
        lastRunAtMs: now - 900_000,
      });

      await evaluateJobsOnce({ nowMs: now, trigger: 'missed-recovery' });

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(useExecutionTraceStore.getState().traces[0]).toMatchObject({
        jobId,
        status: 'success',
        trigger: 'missed-recovery',
      });
    });

    it('skips active attempts but recovers stale running attempts', async () => {
      const now = 1_700_000_400_000;
      const nowSpy = mockNow(now);
      const executeFn = jest.fn().mockResolvedValue('ok');
      setSchedulerExecutor({ execute: executeFn });

      const jobId = useSchedulerStore.getState().addJob({
        name: 'Lease Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'lease',
      });
      setJobRuntime(jobId, {
        nextRunAtMs: now - 1,
        runningAttemptId: 'active-attempt',
        runningStartedAtMs: now - 60_000,
      });

      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });
      expect(executeFn).not.toHaveBeenCalled();

      nowSpy.mockReturnValue(now + 11 * 60_000);
      await evaluateJobsOnce({ nowMs: now + 11 * 60_000, trigger: 'scheduled' });
      expect(executeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('runJobNow', () => {
    it('runs a disabled job when explicitly requested', async () => {
      const now = 1_700_000_500_000;
      mockNow(now);
      const executeFn = jest.fn().mockResolvedValue('manual');
      setSchedulerExecutor({ execute: executeFn });

      const jobId = useSchedulerStore.getState().addJob({
        name: 'Manual Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'manual',
      });
      useSchedulerStore.getState().disableJob(jobId);

      await expect(runJobNow(jobId, { nowMs: now })).resolves.toEqual({
        status: 'completed',
        id: jobId,
        name: 'Manual Job',
      });
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(useExecutionTraceStore.getState().traces[0]).toMatchObject({
        trigger: 'manual',
        status: 'success',
      });
    });
  });

  describe('resetJobRetry', () => {
    it('does not throw for unknown job', () => {
      expect(() => resetJobRetry('unknown-id')).not.toThrow();
    });

    it('clears persisted retry fields for a known job', () => {
      const now = 1_700_000_600_000;
      mockNow(now);
      const jobId = useSchedulerStore.getState().addJob({
        name: 'retry-test',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'test',
      });
      setJobRuntime(jobId, {
        retryAttempts: 1,
        nextRetryAtMs: now + 30_000,
        lastError: 'fail',
      });

      resetJobRetry(jobId);

      const job = useSchedulerStore.getState().getJob(jobId);
      expect(job?.retryAttempts).toBe(0);
      expect(job?.nextRetryAtMs).toBeUndefined();
      expect(job?.lastError).toBeUndefined();
    });
  });
});
