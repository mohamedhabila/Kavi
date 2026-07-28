const mockFlushSchedulerStorePersistenceNow = jest.fn().mockResolvedValue(undefined);
const mockReportReconciledAttempt = jest.fn(async (job: any, timestamp: number) => {
  const { useExecutionTraceStore } = jest.requireActual('../../src/services/scheduler/traceStore');
  useExecutionTraceStore.getState().addTrace({
    id: `trace-ambiguous-${job.id}-${job.lastAmbiguousAttemptId}`,
    jobId: job.id,
    jobName: job.name,
    startedAt: job.lastAmbiguousStartedAtMs ?? timestamp,
    completedAt: timestamp,
    durationMs: 0,
    status: 'error',
    error: job.lastError,
    attempt: job.lastAmbiguousAttemptNumber,
    trigger: 'missed-recovery',
  });
});
jest.mock('../../src/services/scheduler/persistence', () => ({
  ...jest.requireActual('../../src/services/scheduler/persistence'),
  flushSchedulerStorePersistenceNow: (...args: any[]) =>
    mockFlushSchedulerStorePersistenceNow(...args),
}));
jest.mock('../../src/services/scheduler/runtimeReadiness', () => ({
  ensureSchedulerRuntimeReady: jest.fn().mockResolvedValue(undefined),
  reportReconciledAttempt: (...args: any[]) => mockReportReconciledAttempt(...args),
  setSchedulerRecoveryFailureNotifier: jest.fn(),
}));
jest.mock('../../src/services/startupRecovery', () => ({
  waitForPersistedAgentRecoveryReadiness: jest.fn().mockResolvedValue(undefined),
}));
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
import { NonRetryableSchedulerExecutionError } from '../../src/services/scheduler/executionError';
import { AppState } from 'react-native';
import { resetSchedulerOperationLockForTests } from '../../src/services/scheduler/operationLock';
import { registerInternalHook, unregisterInternalHook } from '../../src/services/events/bus';
import { abortAllScheduledJobExecutions } from '../../src/services/scheduler/executionLifecycle';
function resetStores() {
  useSchedulerStore.setState({ jobs: [], terminalReports: [] });
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
    (AppState as any).currentState = 'active';
    stopScheduler();
    resetStores();
    setSchedulerExecutor(null);
    resetSchedulerOperationLockForTests();
    mockFlushSchedulerStorePersistenceNow.mockClear();
    mockFlushSchedulerStorePersistenceNow.mockResolvedValue(undefined);
    mockReportReconciledAttempt.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    stopScheduler();
  });
  describe('startScheduler / stopScheduler', () => {
    it('starts and stops without error', () => {
      setSchedulerExecutor({ execute: async () => ({ output: 'ok' }) });
      expect(() => startScheduler()).not.toThrow();
      expect(() => stopScheduler()).not.toThrow();
    });
    it('does not create multiple intervals on double start', () => {
      setSchedulerExecutor({ execute: async () => ({ output: 'ok' }) });
      startScheduler();
      startScheduler();
      stopScheduler();
    });
    it('recreates the interval when foreground start races an in-flight stop', async () => {
      const now = 1_700_000_010_000;
      mockNow(now);
      let releaseExecution!: () => void;
      const execute = jest.fn(
        () =>
          new Promise<{ output: string }>(
            (resolve) => (releaseExecution = () => resolve({ output: 'ok' })),
          ),
      );
      setSchedulerExecutor({ execute });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Restart race',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'run once',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });
      const intervalSpy = jest.spyOn(global, 'setInterval');
      const firstStart = startScheduler();
      for (let index = 0; index < 10 && execute.mock.calls.length === 0; index += 1) {
        await Promise.resolve();
      }
      expect(execute).toHaveBeenCalledTimes(1);
      stopScheduler();
      const foregroundStart = startScheduler();
      releaseExecution();
      await Promise.all([firstStart, foregroundStart]);
      expect(intervalSpy).toHaveBeenCalledTimes(2);
    });
  });
  describe('evaluateJobsOnce', () => {
    it('does not crash with empty job list', async () => {
      setSchedulerExecutor({ execute: async () => ({ output: 'ok' }) });
      await expect(evaluateJobsOnce()).resolves.toBeUndefined();
    });
    it('does not claim agent work while the app is backgrounded', async () => {
      const previousState = AppState.currentState;
      (AppState as any).currentState = 'background';
      const execute = jest.fn().mockResolvedValue({ output: 'should not run' });
      setSchedulerExecutor({ execute });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Foreground only',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'do work',
      });
      setJobRuntime(jobId, { nextRunAtMs: Date.now() - 1 });
      await evaluateJobsOnce({ trigger: 'scheduled' });
      expect(execute).not.toHaveBeenCalled();
      expect(useSchedulerStore.getState().getJob(jobId)?.runningAttemptId).toBeUndefined();
      (AppState as any).currentState = previousState;
    });
    it('suppresses replay when backgrounding aborts an unsafe task-run hook', async () => {
      const execute = jest.fn().mockResolvedValue({ output: 'must not run' });
      setSchedulerExecutor({ execute });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Hook abort',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'run hook',
      });
      const handler = jest.fn(async () => {
        expect(useSchedulerStore.getState().getJob(jobId)?.runningEffectRisk).toBe('unsafe');
        expect(abortAllScheduledJobExecutions()).toBe(1);
      });
      registerInternalHook('scheduler:task_run', handler);
      let result;
      try {
        result = await runJobNow(jobId);
      } finally {
        unregisterInternalHook('scheduler:task_run', handler);
      }
      expect(result).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('replay was suppressed'),
      });
      expect(execute).not.toHaveBeenCalled();
      expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
        retryAttempts: 0,
        nextRetryAtMs: undefined,
        runningAttemptId: undefined,
        lastError: expect.stringContaining('replay was suppressed'),
      });
    });
    it('never retries a transient executor failure after a task-run hook side effect', async () => {
      const execute = jest.fn().mockRejectedValue(new Error('provider temporarily unavailable'));
      setSchedulerExecutor({ execute });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Hook side effect',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'run after hook',
      });
      let hookSideEffects = 0;
      const handler = jest.fn(async () => {
        hookSideEffects += 1;
      });
      registerInternalHook('scheduler:task_run', handler);
      let result;
      try {
        result = await runJobNow(jobId);
      } finally {
        unregisterInternalHook('scheduler:task_run', handler);
      }
      expect(result).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('replay was suppressed'),
      });
      expect(hookSideEffects).toBe(1);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
        retryAttempts: 0,
        nextRetryAtMs: undefined,
        runningAttemptId: undefined,
        lastAmbiguousAttemptId: expect.any(String),
      });
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
      const executeFn = jest.fn().mockResolvedValue({ output: 'done' });
      const onSuccess = jest.fn().mockResolvedValue(undefined);
      setSchedulerExecutor({ execute: executeFn, onSuccess });
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
      expect(mockFlushSchedulerStorePersistenceNow).toHaveBeenCalledTimes(3);
      expect(mockFlushSchedulerStorePersistenceNow.mock.invocationCallOrder[0]).toBeLessThan(
        executeFn.mock.invocationCallOrder[0],
      );
      expect(mockFlushSchedulerStorePersistenceNow.mock.invocationCallOrder[1]).toBeLessThan(
        onSuccess.mock.invocationCallOrder[0],
      );
    });
    it('records notification-only delivery degradation without replaying work', async () => {
      const now = 1_700_000_125_000;
      mockNow(now);
      const executeFn = jest.fn().mockResolvedValue({ output: 'completed result' });
      const onSuccess = jest.fn().mockRejectedValue(new Error('notifications denied'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      setSchedulerExecutor({ execute: executeFn, onSuccess });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Notification Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'notify me',
        deliveryMode: 'notification',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });
      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(useSchedulerStore.getState().getJob(jobId)?.lastDeliveryError).toContain(
        'notifications denied',
      );
      expect(useExecutionTraceStore.getState().traces[0]).toMatchObject({
        status: 'success',
        warnings: [expect.stringContaining('notifications denied')],
      });
      warnSpy.mockRestore();
    });
    it('allows only one concurrent evaluator to execute a due occurrence', async () => {
      const now = 1_700_000_150_000;
      mockNow(now);
      let releaseExecution!: () => void;
      const executeFn = jest.fn(
        () =>
          new Promise<{ output: string }>((resolve) => {
            releaseExecution = () => resolve({ output: 'done' });
          }),
      );
      setSchedulerExecutor({ execute: executeFn });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Concurrent Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'run once',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });
      const first = evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });
      await Promise.resolve();
      const second = evaluateJobsOnce({ nowMs: now, trigger: 'foreground-reconcile' });
      await second;
      expect(executeFn).toHaveBeenCalledTimes(1);
      releaseExecution();
      await first;
    });
    it('terminalizes against the latest disabled definition instead of scheduling a dead retry', async () => {
      const now = 1_700_000_160_000;
      mockNow(now);
      let rejectExecution!: (error: Error) => void;
      const executeFn = jest.fn(
        () =>
          new Promise<{ output: string }>((_resolve, reject) => {
            rejectExecution = reject;
          }),
      );
      setSchedulerExecutor({ execute: executeFn });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Disable while running',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'run once',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });
      const evaluation = evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(executeFn).toHaveBeenCalledTimes(1);
      useSchedulerStore.getState().disableJob(jobId);
      rejectExecution(new Error('provider unavailable'));
      await evaluation;
      expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
        enabled: false,
        nextRetryAtMs: undefined,
        retryAttempts: 0,
        runningAttemptId: undefined,
      });
      expect(useExecutionTraceStore.getState().traces[0]?.status).toBe('error');
    });
    it('does not execute when the durable claim fence fails', async () => {
      const now = 1_700_000_175_000;
      mockNow(now);
      mockFlushSchedulerStorePersistenceNow
        .mockRejectedValueOnce(new Error('claim write failed'))
        .mockResolvedValue(undefined);
      const executeFn = jest.fn().mockResolvedValue({ output: 'must not run' });
      setSchedulerExecutor({ execute: executeFn });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Claim Fence Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'guard dispatch',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });
      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });
      expect(executeFn).not.toHaveBeenCalled();
      expect(useExecutionTraceStore.getState().traces[0]).toMatchObject({
        status: 'retrying',
        error: expect.stringContaining('claim write failed'),
      });
    });
    it('reconciles a completed claim in-process when persistence recovers', async () => {
      jest.useFakeTimers();
      const now = 1_700_000_190_000;
      mockNow(now);
      mockFlushSchedulerStorePersistenceNow
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('terminal write failed'))
        .mockResolvedValue(undefined);
      const executeFn = jest.fn().mockResolvedValue({ output: 'effect completed' });
      const onSuccess = jest.fn().mockResolvedValue(undefined);
      setSchedulerExecutor({ execute: executeFn, onSuccess });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Terminal Fence Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'perform effect',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });
      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });
      await evaluateJobsOnce({ nowMs: now + 60_000, trigger: 'scheduled' });
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(useSchedulerStore.getState().getJob(jobId)?.runningAttemptId).toBeDefined();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
        runningAttemptId: undefined,
        lastSuccessAtMs: now,
        lastError: undefined,
      });
      expect(useExecutionTraceStore.getState().traces[0]).toMatchObject({
        status: 'success',
        output: 'effect completed',
      });
      jest.useRealTimers();
    });
    it('persists retry cooldown and retries only after the cooldown expires', async () => {
      const now = 1_700_000_200_000;
      const nowSpy = mockNow(now);
      const executeFn = jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce({ output: 'recovered' });
      const onFinalFailure = jest.fn().mockResolvedValue(undefined);
      setSchedulerExecutor({ execute: executeFn, onFinalFailure });
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
      expect(onFinalFailure).not.toHaveBeenCalled();
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
      expect(onFinalFailure).not.toHaveBeenCalled();
    });
    it('honors maxRetries as the number of retries after the first attempt', async () => {
      const now = 1_700_000_225_000;
      const nowSpy = mockNow(now);
      const executeFn = jest.fn().mockRejectedValue(new Error('still unavailable'));
      const onFinalFailure = jest.fn().mockResolvedValue(undefined);
      setSchedulerExecutor({ execute: executeFn, onFinalFailure });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Bounded Retry Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'retry safely',
        failureAlert: { enabled: true, maxRetries: 2 },
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });
      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });
      nowSpy.mockReturnValue(now + 30_000);
      await evaluateJobsOnce({ nowMs: now + 30_000, trigger: 'scheduled' });
      nowSpy.mockReturnValue(now + 90_000);
      await evaluateJobsOnce({ nowMs: now + 90_000, trigger: 'scheduled' });
      expect(executeFn).toHaveBeenCalledTimes(3);
      expect(onFinalFailure).toHaveBeenCalledTimes(1);
      expect(useExecutionTraceStore.getState().traces.map((trace) => trace.status)).toEqual([
        'error',
        'retrying',
        'retrying',
      ]);
    });
    it('does not replay an explicitly non-retryable execution failure', async () => {
      const now = 1_700_000_250_000;
      mockNow(now);
      const executeFn = jest
        .fn()
        .mockRejectedValue(
          new NonRetryableSchedulerExecutionError(new Error('side effect state is uncertain')),
        );
      const onFinalFailure = jest.fn().mockResolvedValue(undefined);
      setSchedulerExecutor({ execute: executeFn, onFinalFailure });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Effectful Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'perform effect',
      });
      setJobRuntime(jobId, { nextRunAtMs: now - 1 });
      await evaluateJobsOnce({ nowMs: now, trigger: 'scheduled' });
      await evaluateJobsOnce({ nowMs: now + 30_000, trigger: 'scheduled' });
      const job = useSchedulerStore.getState().getJob(jobId);
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(job?.retryAttempts).toBe(0);
      expect(job?.nextRetryAtMs).toBeUndefined();
      expect(useExecutionTraceStore.getState().traces[0]).toMatchObject({
        status: 'error',
        error: 'side effect state is uncertain',
      });
      expect(onFinalFailure).toHaveBeenCalledTimes(1);
      expect(onFinalFailure).toHaveBeenCalledWith(
        expect.objectContaining({ id: jobId }),
        expect.objectContaining({ message: 'side effect state is uncertain' }),
        expect.stringMatching(/^scheduler-terminal-/),
      );
    });
    it('recovers a missed run from persisted nextRunAtMs after a cold start', async () => {
      const now = 1_700_000_300_000;
      mockNow(now);
      const executeFn = jest.fn().mockResolvedValue({ output: 'missed recovered' });
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
    it('never replays a claimed very-long-running attempt based on elapsed time', async () => {
      const now = 1_700_000_400_000;
      const nowSpy = mockNow(now);
      const executeFn = jest.fn().mockResolvedValue({ output: 'ok' });
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
      expect(executeFn).not.toHaveBeenCalled();

      const thirtyDaysLater = now + 30 * 24 * 60 * 60_000;
      nowSpy.mockReturnValue(thirtyDaysLater);
      await evaluateJobsOnce({ nowMs: thirtyDaysLater, trigger: 'scheduled' });
      expect(executeFn).not.toHaveBeenCalled();
    });
  });
  describe('runJobNow', () => {
    it('runs a disabled job when explicitly requested', async () => {
      const now = 1_700_000_500_000;
      mockNow(now);
      const executeFn = jest.fn().mockResolvedValue({ output: 'manual' });
      setSchedulerExecutor({ execute: executeFn });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Manual Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'manual',
      });
      useSchedulerStore.getState().disableJob(jobId);
      await expect(runJobNow(jobId, { nowMs: now })).resolves.toEqual({
        status: 'succeeded',
        id: jobId,
        name: 'Manual Job',
      });
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(useExecutionTraceStore.getState().traces[0]).toMatchObject({
        trigger: 'manual',
        status: 'success',
      });
    });
    it('does not force a disabled job through a stale wake notification', async () => {
      const now = 1_700_000_510_000;
      mockNow(now);
      const executeFn = jest.fn().mockResolvedValue({ output: 'must not run' });
      setSchedulerExecutor({ execute: executeFn });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Disabled wake job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'ignore stale wake',
      });
      useSchedulerStore.getState().disableJob(jobId);
      await expect(
        runJobNow(jobId, { nowMs: now, trigger: 'notification-tap', force: false }),
      ).resolves.toMatchObject({
        status: 'skipped',
        error: expect.stringContaining('disabled or is not due'),
      });
      expect(executeFn).not.toHaveBeenCalled();
    });
    it('rearms a due wake when a notification tap arrives before the app is active', async () => {
      const now = 1_700_000_515_000;
      mockNow(now);
      (AppState as any).currentState = 'inactive';
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Cold tap',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'run after activation',
      });
      setJobRuntime(jobId, {
        nextRunAtMs: now - 1,
        pendingWakeNotificationId: 'due-wake',
        pendingWakeNotificationRunAtMs: now - 1,
      });
      await expect(
        runJobNow(jobId, { nowMs: now, trigger: 'notification-tap', force: false }),
      ).resolves.toMatchObject({ status: 'skipped', error: expect.stringContaining('not active') });
      expect(useSchedulerStore.getState().getJob(jobId)?.pendingWakeNotificationId).toMatch(
        /^scheduler-wake-[0-9a-f]{32}$/,
      );
    });
    it.each([
      ['retrying', new Error('temporary manual failure')],
      ['failed', new NonRetryableSchedulerExecutionError(new Error('unsafe to replay manually'))],
    ])('reports a %s manual execution truthfully', async (status, error) => {
      const now = 1_700_000_525_000;
      mockNow(now);
      setSchedulerExecutor({ execute: jest.fn().mockRejectedValue(error) });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Manual Failure Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'manual failure',
      });
      await expect(runJobNow(jobId, { nowMs: now })).resolves.toMatchObject({
        status,
        id: jobId,
        error: expect.any(String),
      });
    });
    it('terminalizes a transient manual failure when the job is disabled', async () => {
      const now = 1_700_000_550_000;
      mockNow(now);
      setSchedulerExecutor({
        execute: jest.fn().mockRejectedValue(new Error('temporarily unavailable')),
      });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Disabled Manual Job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'manual failure',
      });
      useSchedulerStore.getState().disableJob(jobId);
      await expect(runJobNow(jobId, { nowMs: now })).resolves.toMatchObject({
        status: 'failed',
        error: 'temporarily unavailable',
      });
      expect(useSchedulerStore.getState().getJob(jobId)?.nextRetryAtMs).toBeUndefined();
    });
    it('keeps a second manual run busy until terminal state is durable', async () => {
      const now = 1_700_000_575_000;
      mockNow(now);
      let releaseTerminalFence!: () => void;
      let signalTerminalFence!: () => void;
      const terminalFenceStarted = new Promise<void>((resolve) => (signalTerminalFence = resolve));
      mockFlushSchedulerStorePersistenceNow
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              releaseTerminalFence = resolve;
              signalTerminalFence();
            }),
        )
        .mockResolvedValue(undefined);
      const execute = jest.fn().mockResolvedValue({ output: 'done' });
      setSchedulerExecutor({ execute });
      const jobId = useSchedulerStore.getState().addJob({
        name: 'Busy manual job',
        schedule: { kind: 'every', everyMs: 60_000 },
        prompt: 'run once',
      });
      const first = runJobNow(jobId, { nowMs: now });
      await terminalFenceStarted;
      await expect(runJobNow(jobId, { nowMs: now })).resolves.toMatchObject({
        status: 'busy',
        error: expect.stringContaining('active execution'),
      });
      expect(execute).toHaveBeenCalledTimes(1);
      releaseTerminalFence();
      await first;
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
