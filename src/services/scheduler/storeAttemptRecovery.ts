import type { CronJob, SchedulerTerminalReport } from '../cron/types';
import {
  canRetrySafelyInterruptedAttempt,
  completeStrandedAttempt,
  deferSafelyInterruptedAttempt,
  terminalizeStrandedAttempt,
} from './storeModel';
import {
  buildReconciledAttemptTerminalReport,
  buildRecoveredCompletionTerminalReport,
  buildSafelyDeferredAttemptTerminalReport,
} from './terminalReport';

export function reconcileScheduledAttempt(
  job: CronJob,
  timestamp: number,
): { job: CronJob; report?: SchedulerTerminalReport } {
  if (job.runningCompletion) {
    return {
      job: completeStrandedAttempt(job),
      report: buildRecoveredCompletionTerminalReport(job),
    };
  }
  if (job.runningEffectRisk === 'safe') {
    const deferred = deferSafelyInterruptedAttempt(job, timestamp);
    return {
      job: deferred,
      report: canRetrySafelyInterruptedAttempt(job)
        ? buildSafelyDeferredAttemptTerminalReport(job, timestamp, deferred.lastError ?? '')
        : undefined,
    };
  }
  const terminal = terminalizeStrandedAttempt(job, timestamp);
  return {
    job: terminal,
    report: buildReconciledAttemptTerminalReport(terminal, timestamp),
  };
}
