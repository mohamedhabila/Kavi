import type { CronJob, SchedulerTerminalReport } from '../cron/types';
import { SchedulerExecutionError } from './executionError';
import type { SchedulerExecutionResult } from './executionResult';
import { notifyScheduledJobFinalFailure, notifyScheduledJobSuccess } from './jobNotifications';
import { withSchedulerOperationLock } from './operationLock';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { useSchedulerStore } from './store';
import { recordExecutionTrace } from './traceRecording';
import { unrefTimerIfSupported } from '../../utils/timers';
import { isPermanentLocalNotificationError } from '../notifications/errors';
import { sanitizeSchedulerReportText } from './terminalReport';

type SuccessNotifier = (
  job: CronJob,
  result: SchedulerExecutionResult,
  notificationIdentifier?: string,
) => Promise<void>;
type FailureNotifier = (
  job: CronJob,
  error: unknown,
  notificationIdentifier?: string,
) => Promise<void>;

let successNotifier: SuccessNotifier = notifyScheduledJobSuccess;
let failureNotifier: FailureNotifier = notifyScheduledJobFinalFailure;
let drainTail: Promise<void> = Promise.resolve();
let drainRetryTimer: ReturnType<typeof setTimeout> | undefined;

export function setSchedulerTerminalReportNotifiers(
  onSuccess?: SuccessNotifier,
  onFailure?: FailureNotifier,
): void {
  successNotifier = onSuccess ?? notifyScheduledJobSuccess;
  failureNotifier = onFailure ?? notifyScheduledJobFinalFailure;
}

async function persistDeliveryWarnings(
  report: SchedulerTerminalReport,
  warnings: string[],
): Promise<void> {
  if (warnings.length === 0) return;
  await withSchedulerOperationLock(async () => {
    const store = useSchedulerStore.getState();
    const recorded = store.recordTerminalReportDeliveryFailure({
      id: report.jobId,
      attemptId: report.id,
      timestamp: Date.now(),
      error: warnings.join(' '),
    });
    if (recorded.jobRecorded || recorded.reportRecorded) {
      await flushSchedulerStorePersistenceNow();
    }
  });
}

async function processTerminalReport(report: SchedulerTerminalReport): Promise<void> {
  const historicalWarnings = [...(report.warnings ?? []), ...(report.deliveryWarnings ?? [])];
  await recordExecutionTrace({
    id: `trace-${report.id}`,
    jobId: report.jobId,
    jobName: report.jobName,
    status: report.status,
    startedAt: report.startedAtMs,
    completedAt: report.completedAtMs,
    output: report.output,
    error: report.error,
    warnings: historicalWarnings,
    attempt: report.attempt,
    trigger: report.trigger,
  });

  const currentJob = useSchedulerStore.getState().getJob(report.jobId);
  const newDeliveryWarnings: string[] = [];
  let notificationError: unknown;
  if (currentJob && report.notification !== 'none') {
    try {
      if (report.notification === 'success') {
        await successNotifier(
          currentJob,
          {
            output: report.output ?? '',
            conversationId: report.conversationId,
            conversationDurable: report.conversationDurable,
            warnings: report.warnings,
          },
          `scheduler-terminal-${report.id}`,
        );
      } else {
        await failureNotifier(
          currentJob,
          new SchedulerExecutionError(
            new Error(report.error ?? 'Scheduled task failed'),
            report.conversationId,
            report.warnings,
            report.conversationDurable !== false,
          ),
          `scheduler-terminal-${report.id}`,
        );
      }
    } catch (error) {
      notificationError = error;
      newDeliveryWarnings.push(
        sanitizeSchedulerReportText(
          `Terminal report notification failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      console.warn('[scheduler] Terminal report notification failed:', error);
    }
  }
  if (newDeliveryWarnings.length > 0) {
    await recordExecutionTrace({
      id: `trace-${report.id}`,
      jobId: report.jobId,
      jobName: report.jobName,
      status: report.status,
      startedAt: report.startedAtMs,
      completedAt: report.completedAtMs,
      output: report.output,
      error: report.error,
      warnings: [...historicalWarnings, ...newDeliveryWarnings],
      attempt: report.attempt,
      trigger: report.trigger,
    });
  }
  await persistDeliveryWarnings(report, newDeliveryWarnings);
  if (notificationError !== undefined && !isPermanentLocalNotificationError(notificationError)) {
    throw notificationError;
  }

  await withSchedulerOperationLock(async () => {
    const store = useSchedulerStore.getState();
    if (
      !store.acknowledgeTerminalReport({
        reportId: report.id,
        clearDeliveryFailure:
          notificationError === undefined && (report.deliveryWarnings?.length ?? 0) > 0,
      })
    ) {
      return;
    }
    try {
      await flushSchedulerStorePersistenceNow();
    } catch (error) {
      store.restoreTerminalReport(report);
      throw error;
    }
  });
}

async function drainReports(): Promise<void> {
  while (true) {
    const report = useSchedulerStore.getState().terminalReports[0];
    if (!report) return;
    await processTerminalReport(report);
  }
}

function scheduleDrainRetry(retryCount = 0): void {
  if (drainRetryTimer) return;
  const delayMs = Math.min(1_000 * 2 ** retryCount, 60_000);
  drainRetryTimer = setTimeout(() => {
    drainRetryTimer = undefined;
    void drainSchedulerTerminalReports().catch((error) => {
      console.warn('[scheduler] Terminal reports are still waiting for delivery:', error);
      scheduleDrainRetry(retryCount + 1);
    });
  }, delayMs);
  unrefTimerIfSupported(drainRetryTimer);
}

export function drainSchedulerTerminalReports(): Promise<void> {
  const running = drainTail.then(drainReports, drainReports);
  const reported = running.catch((error) => {
    scheduleDrainRetry();
    throw error;
  });
  drainTail = reported.catch(() => undefined);
  return reported;
}

export function resetSchedulerTerminalReportProcessorForTests(): void {
  if (drainRetryTimer) clearTimeout(drainRetryTimer);
  drainRetryTimer = undefined;
  drainTail = Promise.resolve();
  setSchedulerTerminalReportNotifiers();
}
