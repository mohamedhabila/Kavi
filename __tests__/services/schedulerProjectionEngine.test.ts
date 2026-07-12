import type { CronJob } from '../../src/services/cron/types';

const mockFlushSchedulerStorePersistenceNow = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/scheduler/persistence', () => ({
  ...jest.requireActual('../../src/services/scheduler/persistence'),
  flushSchedulerStorePersistenceNow: (...args: unknown[]) =>
    mockFlushSchedulerStorePersistenceNow(...args),
}));
jest.mock('../../src/services/scheduler/runtimeReadiness', () => ({
  ensureSchedulerRuntimeReady: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/startupRecovery', () => ({
  waitForPersistedAgentRecoveryReadiness: jest.fn().mockResolvedValue(undefined),
}));

import { AppState } from 'react-native';
import {
  runJobNow,
  setSchedulerExecutor,
  stopScheduler,
} from '../../src/services/scheduler/engine';
import {
  SchedulerProjectionBusyError,
  SchedulerProjectionReleaseError,
} from '../../src/services/scheduler/executionError';
import { resetSchedulerOperationLockForTests } from '../../src/services/scheduler/operationLock';
import { useSchedulerStore } from '../../src/services/scheduler/store';
import { useExecutionTraceStore } from '../../src/services/scheduler/traceStore';
import { useChatStore } from '../../src/store/useChatStore';

function setJobRuntime(id: string, updates: Partial<CronJob>): void {
  useSchedulerStore.setState({
    jobs: useSchedulerStore
      .getState()
      .jobs.map((job) => (job.id === id ? { ...job, ...updates } : job)),
  });
}

beforeEach(() => {
  (AppState as any).currentState = 'active';
  stopScheduler();
  setSchedulerExecutor(null);
  resetSchedulerOperationLockForTests();
  useSchedulerStore.setState({ jobs: [], terminalReports: [] });
  useExecutionTraceStore.setState({ traces: [] });
  useChatStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
  mockFlushSchedulerStorePersistenceNow.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  stopScheduler();
});

describe('scheduler projection engine settlement', () => {
  it('defers contention without consuming retry budget or changing occurrence', async () => {
    const now = 1_700_000_075_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const execute = jest
      .fn()
      .mockRejectedValue(
        new SchedulerProjectionBusyError('model_projection_intent', 'conversation-1'),
      );
    setSchedulerExecutor({ execute });
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Busy conversation',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'wait for foreground work',
      failureAlert: { enabled: true, maxRetries: 3 },
    });

    await expect(runJobNow(jobId, { nowMs: now })).resolves.toMatchObject({
      status: 'busy',
      error: expect.stringContaining('using this conversation'),
    });

    const job = useSchedulerStore.getState().getJob(jobId);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(job).toMatchObject({
      retryAttempts: 0,
      nextRetryAtMs: now,
      retryOccurrenceId: expect.stringMatching(/^attempt-/),
      runningAttemptId: undefined,
    });
  });

  it('recovers completion after a release flush failure without replay', async () => {
    jest.useFakeTimers();
    const now = 1_700_000_195_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const execute = jest.fn().mockImplementation(async (job: CronJob) => {
      useSchedulerStore.getState().recordRunningAttemptCompletion({
        id: job.id,
        attemptId: job.runningAttemptId!,
        completion: {
          completedAtMs: now,
          output: 'completed before release failed',
          conversationId: 'conversation-1',
          conversationDurable: true,
        },
      });
      throw new SchedulerProjectionReleaseError(
        new Error('projection release flush failed'),
        'conversation-1',
        true,
      );
    });
    setSchedulerExecutor({ execute });
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Projection release recovery',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'complete once',
    });
    setJobRuntime(jobId, { nextRunAtMs: now - 1 });

    await expect(runJobNow(jobId, { nowMs: now })).resolves.toMatchObject({
      status: 'failed',
      error: 'projection release flush failed',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      runningAttemptId: expect.any(String),
      runningCompletion: { output: 'completed before release failed' },
      retryAttempts: 0,
    });

    await jest.advanceTimersByTimeAsync(1_000);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(useSchedulerStore.getState().getJob(jobId)).toMatchObject({
      runningAttemptId: undefined,
      runningCompletion: undefined,
      lastSuccessAtMs: now,
      retryAttempts: 0,
    });
  });
});
