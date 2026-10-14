jest.mock('../../src/services/scheduler/persistence', () => ({
  ...jest.requireActual('../../src/services/scheduler/persistence'),
  flushSchedulerStorePersistenceNow: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/scheduler/runtimeReadiness', () => ({
  ensureSchedulerRuntimeReady: jest.fn().mockResolvedValue(undefined),
  reportReconciledAttempt: jest.fn().mockResolvedValue(undefined),
  setSchedulerRecoveryFailureNotifier: jest.fn(),
}));
jest.mock('../../src/services/startupRecovery', () => ({
  waitForPersistedAgentRecoveryReadiness: jest.fn().mockResolvedValue(undefined),
}));
import { AppState } from 'react-native';
import {
  evaluateJobsOnce,
  setSchedulerExecutor,
  stopScheduler,
} from '../../src/services/scheduler/engine';
import { withHeadlessSchedulerHost } from '../../src/services/scheduler/headlessHost';
import { resetSchedulerOperationLockForTests } from '../../src/services/scheduler/operationLock';
import { useSchedulerStore } from '../../src/services/scheduler/store';
import { useExecutionTraceStore } from '../../src/services/scheduler/traceStore';

function setJobRuntime(id: string, updates: Record<string, unknown>) {
  useSchedulerStore.setState({
    jobs: useSchedulerStore
      .getState()
      .jobs.map((job) => (job.id === id ? { ...job, ...updates } : job)),
  });
}

describe('Scheduler Engine host', () => {
  beforeEach(() => {
    (AppState as any).currentState = 'active';
    stopScheduler();
    useSchedulerStore.setState({ jobs: [], terminalReports: [] });
    useExecutionTraceStore.setState({ traces: [] });
    setSchedulerExecutor(null);
    resetSchedulerOperationLockForTests();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    stopScheduler();
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
  // A due task used to wait until the person opened the app. A native background job
  // (Android WorkManager) now hosts the run while the app is closed.
  it('runs due work in the background while a background job hosts it', async () => {
    const previousState = AppState.currentState;
    (AppState as any).currentState = 'background';
    const execute = jest.fn().mockResolvedValue({ output: 'Morning brief ready.' });
    setSchedulerExecutor({ execute });
    const dueAtMs = Date.now() - 1;
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Morning brief',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'brief me',
    });
    setJobRuntime(jobId, { nextRunAtMs: dueAtMs });
    await withHeadlessSchedulerHost(() => evaluateJobsOnce({ trigger: 'background-wake' }));
    expect(execute).toHaveBeenCalledTimes(1);
    const job = useSchedulerStore.getState().getJob(jobId);
    expect(job?.runningAttemptId).toBeUndefined();
    expect(job?.nextRunAtMs).toBeGreaterThan(dueAtMs);
    (AppState as any).currentState = previousState;
  });
});
