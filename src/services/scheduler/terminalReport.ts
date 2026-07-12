import type { CronJob, SchedulerTerminalReport, SchedulerTrigger } from '../cron/types';
import { buildHeadTailExcerpt } from '../../utils/headTailExcerpt';

export const MAX_SCHEDULER_REPORT_TEXT_CHARS = 2_000;
export const MAX_SCHEDULER_REPORT_WARNING_CHARS = 500;
export const MAX_SCHEDULER_REPORT_WARNINGS = 10;

export function sanitizeSchedulerReportText(value: string): string {
  return buildHeadTailExcerpt(value, MAX_SCHEDULER_REPORT_TEXT_CHARS);
}

export function sanitizeSchedulerTerminalReport(
  report: SchedulerTerminalReport,
): SchedulerTerminalReport {
  return {
    ...report,
    jobName: buildHeadTailExcerpt(report.jobName, 200),
    output: report.output ? sanitizeSchedulerReportText(report.output) : undefined,
    error: report.error ? sanitizeSchedulerReportText(report.error) : undefined,
    warnings: (Array.isArray(report.warnings) ? report.warnings : undefined)
      ?.filter((warning): warning is string => typeof warning === 'string')
      .slice(0, MAX_SCHEDULER_REPORT_WARNINGS)
      .map((warning) => buildHeadTailExcerpt(warning, MAX_SCHEDULER_REPORT_WARNING_CHARS)),
    deliveryWarnings: (Array.isArray(report.deliveryWarnings) ? report.deliveryWarnings : undefined)
      ?.filter((warning): warning is string => typeof warning === 'string')
      .slice(0, MAX_SCHEDULER_REPORT_WARNINGS)
      .map((warning) => buildHeadTailExcerpt(warning, MAX_SCHEDULER_REPORT_WARNING_CHARS)),
    conversationId: report.conversationId?.slice(0, 256),
  };
}

export function buildSchedulerTerminalReport(params: {
  attemptId: string;
  job: CronJob;
  status: SchedulerTerminalReport['status'];
  notification: SchedulerTerminalReport['notification'];
  startedAtMs: number;
  completedAtMs: number;
  attempt: number;
  trigger: SchedulerTrigger;
  output?: string;
  error?: string;
  warnings?: string[];
  conversationId?: string;
  conversationDurable?: boolean;
}): SchedulerTerminalReport {
  return sanitizeSchedulerTerminalReport({
    id: params.attemptId,
    jobId: params.job.id,
    jobName: params.job.name,
    status: params.status,
    notification: params.notification,
    startedAtMs: params.startedAtMs,
    completedAtMs: params.completedAtMs,
    attempt: params.attempt,
    trigger: params.trigger,
    output: params.output,
    error: params.error,
    warnings: params.warnings,
    conversationId: params.conversationId,
    conversationDurable: params.conversationDurable,
  });
}

export function buildReconciledAttemptTerminalReport(
  job: CronJob,
  completedAtMs: number,
): SchedulerTerminalReport | undefined {
  const attemptId = job.lastAmbiguousAttemptId;
  if (!attemptId) return undefined;
  return buildSchedulerTerminalReport({
    attemptId,
    job,
    status: 'error',
    notification: 'failure',
    startedAtMs: job.lastAmbiguousStartedAtMs ?? completedAtMs,
    completedAtMs,
    attempt: job.lastAmbiguousAttemptNumber ?? 1,
    trigger: 'missed-recovery',
    error:
      job.lastError ??
      'A previous scheduled attempt ended without a durable terminal record; replay was suppressed.',
  });
}

export function buildSafelyDeferredAttemptTerminalReport(
  job: CronJob,
  completedAtMs: number,
  error: string,
): SchedulerTerminalReport | undefined {
  const attemptId = job.runningAttemptId;
  if (!attemptId) return undefined;
  return buildSchedulerTerminalReport({
    attemptId,
    job,
    status: 'retrying',
    notification: 'none',
    startedAtMs: job.runningStartedAtMs ?? completedAtMs,
    completedAtMs,
    attempt: job.runningAttemptNumber ?? 1,
    trigger: 'missed-recovery',
    error,
    conversationId: job.runningConversationId,
    conversationDurable: Boolean(job.runningConversationId),
  });
}

export function buildRecoveredCompletionTerminalReport(
  job: CronJob,
): SchedulerTerminalReport | undefined {
  const attemptId = job.runningAttemptId;
  const completion = job.runningCompletion;
  if (!attemptId || !completion) return undefined;
  return buildSchedulerTerminalReport({
    attemptId,
    job,
    status: 'success',
    notification: 'success',
    startedAtMs: job.runningStartedAtMs ?? completion.completedAtMs,
    completedAtMs: completion.completedAtMs,
    attempt: job.runningAttemptNumber ?? 1,
    trigger: 'missed-recovery',
    output: completion.output,
    warnings: completion.warnings,
    conversationId: completion.conversationId,
    conversationDurable: completion.conversationDurable,
  });
}
