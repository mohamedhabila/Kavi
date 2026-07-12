import type { CronJob, SchedulerTerminalReport } from '../cron/types';
import { safeComputeNextRunAtMs, shouldDisableAfterRun } from './storeModel';

export type RunFailureUpdate = {
  timestamp: number;
  error: string;
  attempt: number;
  nextRetryAtMs?: number;
  final: boolean;
};

function clearRunningAttempt(job: CronJob): CronJob {
  return {
    ...job,
    runningAttemptId: undefined,
    runningStartedAtMs: undefined,
    runningDefinitionRevision: undefined,
    runningAttemptNumber: undefined,
    runningConversationId: undefined,
    runningEffectRisk: undefined,
    runningOccurrenceId: undefined,
    runningCompletion: undefined,
  };
}

export function settleScheduledRunSuccess(
  job: CronJob,
  attemptId: string,
  definitionRevision: number,
  timestamp: number,
): CronJob {
  if (job.definitionRevision !== definitionRevision) {
    return clearRunningAttempt({
      ...job,
      updatedAtMs: Date.now(),
      lastRunAtMs: timestamp,
      lastAttemptAtMs: timestamp,
      lastSuccessAtMs: timestamp,
      lastSettledAttemptId: attemptId,
      retryAttempts: 0,
      nextRetryAtMs: undefined,
      retryConversationId: undefined,
      retryOccurrenceId: undefined,
    });
  }
  const disable = shouldDisableAfterRun(job);
  return clearRunningAttempt({
    ...job,
    enabled: disable ? false : job.enabled,
    updatedAtMs: Date.now(),
    lastRunAtMs: timestamp,
    lastAttemptAtMs: timestamp,
    lastSuccessAtMs: timestamp,
    lastError: undefined,
    lastDeliveryError: undefined,
    lastDeliveryFailureAtMs: undefined,
    lastSettledAttemptId: attemptId,
    retryAttempts: 0,
    nextRetryAtMs: undefined,
    retryConversationId: undefined,
    retryOccurrenceId: undefined,
    nextRunAtMs: disable ? undefined : safeComputeNextRunAtMs(job.schedule, timestamp),
  });
}

export function settleScheduledRunFailure(
  job: CronJob,
  attemptId: string,
  definitionRevision: number,
  update: RunFailureUpdate,
  report: SchedulerTerminalReport,
): CronJob {
  const replayUnsafe = job.runningEffectRisk === 'unsafe';
  const final = update.final || replayUnsafe;
  const ambiguousAttempt = replayUnsafe
    ? {
        lastAmbiguousAttemptId: attemptId,
        lastAmbiguousAtMs: update.timestamp,
        lastAmbiguousStartedAtMs: job.runningStartedAtMs,
        lastAmbiguousAttemptNumber: job.runningAttemptNumber ?? update.attempt,
      }
    : {};
  if (job.definitionRevision !== definitionRevision) {
    return clearRunningAttempt({
      ...job,
      updatedAtMs: Date.now(),
      lastRunAtMs: final ? update.timestamp : job.lastRunAtMs,
      lastAttemptAtMs: update.timestamp,
      lastFailureAtMs: update.timestamp,
      lastError: update.error,
      lastSettledAttemptId: attemptId,
      retryAttempts: 0,
      nextRetryAtMs: undefined,
      retryConversationId: undefined,
      retryOccurrenceId: undefined,
      ...ambiguousAttempt,
    });
  }
  const disable = final && shouldDisableAfterRun(job);
  return clearRunningAttempt({
    ...job,
    enabled: disable ? false : job.enabled,
    updatedAtMs: Date.now(),
    lastRunAtMs: final ? update.timestamp : job.lastRunAtMs,
    lastAttemptAtMs: update.timestamp,
    lastFailureAtMs: update.timestamp,
    lastError: update.error,
    lastDeliveryError: undefined,
    lastDeliveryFailureAtMs: undefined,
    lastSettledAttemptId: attemptId,
    retryAttempts: final ? 0 : update.attempt,
    nextRetryAtMs: final ? undefined : update.nextRetryAtMs,
    retryConversationId: final
      ? undefined
      : report.conversationDurable !== false && report.conversationId
        ? report.conversationId
        : job.retryConversationId,
    retryOccurrenceId: final ? undefined : (job.runningOccurrenceId ?? job.retryOccurrenceId),
    nextRunAtMs: final
      ? disable
        ? undefined
        : safeComputeNextRunAtMs(job.schedule, update.timestamp)
      : job.nextRunAtMs,
    ...ambiguousAttempt,
  });
}
