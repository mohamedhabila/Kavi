const mockFlushSchedulerStorePersistenceNow = jest.fn().mockResolvedValue(undefined);
const mockRecordExecutionTrace = jest.fn().mockResolvedValue(undefined);
const mockNotifySuccess = jest.fn().mockResolvedValue(undefined);
const mockNotifyFailure = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/scheduler/persistence', () => ({
  ...jest.requireActual('../../src/services/scheduler/persistence'),
  flushSchedulerStorePersistenceNow: (...args: any[]) =>
    mockFlushSchedulerStorePersistenceNow(...args),
}));
jest.mock('../../src/services/scheduler/traceRecording', () => ({
  recordExecutionTrace: (...args: any[]) => mockRecordExecutionTrace(...args),
}));
jest.mock('../../src/services/scheduler/jobNotifications', () => ({
  notifyScheduledJobSuccess: (...args: any[]) => mockNotifySuccess(...args),
  notifyScheduledJobFinalFailure: (...args: any[]) => mockNotifyFailure(...args),
}));

import { useSchedulerStore } from '../../src/services/scheduler/store';
import {
  drainSchedulerTerminalReports,
  resetSchedulerTerminalReportProcessorForTests,
} from '../../src/services/scheduler/terminalReportProcessor';
import type { SchedulerTerminalReport } from '../../src/services/cron/types';
import { NotificationPermissionDeniedError } from '../../src/services/notifications/errors';

function seedReport(overrides: Partial<SchedulerTerminalReport> = {}) {
  const jobId = useSchedulerStore.getState().addJob({
    name: 'Durable report',
    prompt: 'complete durably',
    schedule: { kind: 'every', everyMs: 60_000 },
    deliveryMode: 'notification',
  });
  const report: SchedulerTerminalReport = {
    id: 'attempt-1',
    jobId,
    jobName: 'Durable report',
    status: 'success',
    notification: 'success',
    startedAtMs: 100,
    completedAtMs: 200,
    attempt: 1,
    trigger: 'scheduled',
    output: 'done',
    ...overrides,
  };
  useSchedulerStore.setState((state) => ({
    jobs: state.jobs.map((job) =>
      job.id === jobId ? { ...job, lastSettledAttemptId: report.id } : job,
    ),
    terminalReports: [report],
  }));
  return { jobId, report };
}

describe('scheduler terminal report processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSchedulerTerminalReportProcessorForTests();
    useSchedulerStore.setState({ jobs: [], terminalReports: [] });
    mockFlushSchedulerStorePersistenceNow.mockResolvedValue(undefined);
    mockRecordExecutionTrace.mockResolvedValue(undefined);
    mockNotifySuccess.mockResolvedValue(undefined);
  });

  it('durably records trace and delivery before acknowledging the outbox entry', async () => {
    const { report } = seedReport();

    await drainSchedulerTerminalReports();

    expect(mockRecordExecutionTrace).toHaveBeenCalledWith(
      expect.objectContaining({ id: `trace-${report.id}`, output: 'done' }),
    );
    expect(mockNotifySuccess).toHaveBeenCalledTimes(1);
    expect(useSchedulerStore.getState().terminalReports).toEqual([]);
  });

  it('keeps the outbox entry when trace persistence is unavailable', async () => {
    seedReport();
    mockRecordExecutionTrace.mockRejectedValueOnce(new Error('trace disk unavailable'));

    await expect(drainSchedulerTerminalReports()).rejects.toThrow('trace disk unavailable');

    expect(mockNotifySuccess).not.toHaveBeenCalled();
    expect(useSchedulerStore.getState().terminalReports).toHaveLength(1);
  });

  it('persists notification degradation and acknowledges attempted delivery', async () => {
    const { jobId } = seedReport();
    mockNotifySuccess.mockRejectedValueOnce(new NotificationPermissionDeniedError());
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await drainSchedulerTerminalReports();

    expect(useSchedulerStore.getState().getJob(jobId)?.lastDeliveryError).toContain(
      'Notification permission denied',
    );
    expect(useSchedulerStore.getState().terminalReports).toEqual([]);
    warnSpy.mockRestore();
  });

  it('retains and retries a transient notification failure with a stable identifier', async () => {
    const { jobId, report } = seedReport();
    mockNotifySuccess.mockRejectedValueOnce(new Error('notification service unavailable'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(drainSchedulerTerminalReports()).rejects.toThrow(
      'notification service unavailable',
    );

    expect(useSchedulerStore.getState().terminalReports).toEqual([
      expect.objectContaining({
        ...report,
        deliveryWarnings: [expect.stringContaining('notification service unavailable')],
      }),
    ]);
    expect(mockNotifySuccess).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      `scheduler-terminal-${report.id}`,
    );

    await drainSchedulerTerminalReports();

    expect(mockNotifySuccess).toHaveBeenCalledTimes(2);
    expect(mockNotifySuccess.mock.calls[1][2]).toBe(mockNotifySuccess.mock.calls[0][2]);
    expect(useSchedulerStore.getState().getJob(jobId)?.lastDeliveryError).toBeUndefined();
    expect(mockRecordExecutionTrace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        warnings: [expect.stringContaining('notification service unavailable')],
      }),
    );
    expect(useSchedulerStore.getState().terminalReports).toEqual([]);
    warnSpy.mockRestore();
  });

  it('restores the report when acknowledgement persistence fails', async () => {
    const { report } = seedReport();
    mockFlushSchedulerStorePersistenceNow
      .mockRejectedValueOnce(new Error('acknowledgement write failed'))
      .mockResolvedValue(undefined);

    await expect(drainSchedulerTerminalReports()).rejects.toThrow('acknowledgement write failed');

    expect(useSchedulerStore.getState().terminalReports).toEqual([report]);
    await drainSchedulerTerminalReports();
    expect(mockNotifySuccess.mock.calls[1][2]).toBe(`scheduler-terminal-${report.id}`);
    expect(useSchedulerStore.getState().terminalReports).toEqual([]);
  });

  it('queues a later drain request behind an in-flight failure', async () => {
    const { report } = seedReport();
    let rejectFirstTrace!: () => void;
    mockRecordExecutionTrace
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstTrace = () => reject(new Error('first trace write failed'));
          }),
      )
      .mockResolvedValue(undefined);
    const firstDrain = drainSchedulerTerminalReports();
    await Promise.resolve();
    const secondReport: SchedulerTerminalReport = {
      ...report,
      id: 'attempt-2',
      completedAtMs: 300,
    };
    useSchedulerStore.setState({ terminalReports: [report, secondReport] });
    const secondDrain = drainSchedulerTerminalReports();

    rejectFirstTrace();
    await expect(firstDrain).rejects.toThrow('first trace write failed');
    await expect(secondDrain).resolves.toBeUndefined();

    expect(mockRecordExecutionTrace).toHaveBeenCalledTimes(3);
    expect(useSchedulerStore.getState().terminalReports).toEqual([]);
  });
});
