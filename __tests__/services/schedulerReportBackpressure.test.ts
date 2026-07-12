const mockDrainSchedulerTerminalReports = jest
  .fn()
  .mockRejectedValue(new Error('trace persistence unavailable'));
const mockSyncSchedulerWakeNotifications = jest
  .fn()
  .mockResolvedValue({ scheduled: [], cancelled: [], warnings: [] });

jest.mock('../../src/services/scheduler/terminalReportProcessor', () => ({
  drainSchedulerTerminalReports: (...args: unknown[]) => mockDrainSchedulerTerminalReports(...args),
  setSchedulerTerminalReportNotifiers: jest.fn(),
}));
jest.mock('../../src/services/scheduler/runtimeReadiness', () => ({
  ensureSchedulerRuntimeReady: jest.fn().mockResolvedValue(undefined),
  setSchedulerRecoveryFailureNotifier: jest.fn(),
}));
jest.mock('../../src/services/startupRecovery', () => ({
  waitForPersistedAgentRecoveryReadiness: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/scheduler/wakeNotifications', () => ({
  syncSchedulerWakeNotifications: (...args: unknown[]) =>
    mockSyncSchedulerWakeNotifications(...args),
}));

import type { SchedulerTerminalReport } from '../../src/services/cron/types';
import { runJobNow, setSchedulerExecutor } from '../../src/services/scheduler/engine';
import { resetSchedulerOperationLockForTests } from '../../src/services/scheduler/operationLock';
import { useSchedulerStore } from '../../src/services/scheduler/store';
import {
  MAX_TERMINAL_REPORTS,
  normalizeTerminalReports,
} from '../../src/services/scheduler/storeModel';
import {
  buildSchedulerTerminalReport,
  MAX_SCHEDULER_REPORT_TEXT_CHARS,
  MAX_SCHEDULER_REPORT_WARNING_CHARS,
  MAX_SCHEDULER_REPORT_WARNINGS,
} from '../../src/services/scheduler/terminalReport';

function terminalReport(index: number): SchedulerTerminalReport {
  return {
    id: `attempt-${index}`,
    jobId: `job-${index}`,
    jobName: `Job ${index}`,
    status: 'success',
    notification: 'none',
    startedAtMs: index + 1,
    completedAtMs: index + 2,
    attempt: 1,
    trigger: 'scheduled',
  };
}

describe('scheduler terminal report backpressure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSchedulerOperationLockForTests();
    useSchedulerStore.setState({ jobs: [], terminalReports: [] });
  });

  afterEach(() => {
    setSchedulerExecutor(null);
  });

  it('retains every persisted report during normalization', () => {
    const reports = Array.from({ length: MAX_TERMINAL_REPORTS + 1 }, (_, index) =>
      terminalReport(index),
    );

    expect(normalizeTerminalReports(reports)).toEqual(reports);
  });

  it('bounds durable terminal report bytes without losing the tail context', () => {
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Bounded report',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'bound persisted output',
    });
    const job = useSchedulerStore.getState().getJob(jobId)!;
    const longText = `head-${'x'.repeat(4_000)}-tail`;
    const built = buildSchedulerTerminalReport({
      attemptId: 'attempt-bounded',
      job,
      status: 'error',
      notification: 'failure',
      startedAtMs: 1,
      completedAtMs: 2,
      attempt: 1,
      trigger: 'scheduled',
      output: longText,
      error: longText,
      warnings: Array.from({ length: 20 }, () => longText),
    });

    expect(built.output).toHaveLength(MAX_SCHEDULER_REPORT_TEXT_CHARS);
    expect(built.output).toContain('-tail');
    expect(built.error).toHaveLength(MAX_SCHEDULER_REPORT_TEXT_CHARS);
    expect(built.warnings).toHaveLength(MAX_SCHEDULER_REPORT_WARNINGS);
    expect(
      built.warnings?.every((warning) => warning.length <= MAX_SCHEDULER_REPORT_WARNING_CHARS),
    ).toBe(true);
  });

  it('keeps a job due instead of executing when the durable report backlog cannot drain', async () => {
    const execute = jest.fn().mockResolvedValue({ output: 'must not run' });
    setSchedulerExecutor({ execute });
    const jobId = useSchedulerStore.getState().addJob({
      name: 'Backpressured job',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'run only when settlement can be reported',
    });
    useSchedulerStore.setState({
      terminalReports: Array.from({ length: MAX_TERMINAL_REPORTS - 2 }, (_, index) =>
        terminalReport(index),
      ),
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runJobNow(jobId)).resolves.toMatchObject({
      status: 'busy',
      error: expect.stringContaining('report delivery is backlogged'),
    });

    expect(mockDrainSchedulerTerminalReports).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(useSchedulerStore.getState().terminalReports).toHaveLength(MAX_TERMINAL_REPORTS - 2);
    expect(useSchedulerStore.getState().getJob(jobId)?.runningAttemptId).toBeUndefined();
    warnSpy.mockRestore();
  });
});
