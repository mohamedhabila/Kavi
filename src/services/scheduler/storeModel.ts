import { computeNextRunAtMs } from '../cron/schedule';
import type {
  CronJob,
  CronSchedule,
  SchedulerRunningCompletion,
  SchedulerTerminalReport,
} from '../cron/types';
import { normalizeSchedulerRetryAttempts } from './eligibility';
import { sanitizeSchedulerReportText, sanitizeSchedulerTerminalReport } from './terminalReport';

export const MAX_TERMINAL_REPORTS = 100;

export function normalizeRunningCompletion(value: unknown): SchedulerRunningCompletion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const completion = value as Partial<SchedulerRunningCompletion>;
  const completedAtMs = finiteTimestamp(completion.completedAtMs);
  if (completedAtMs === undefined || typeof completion.output !== 'string') return undefined;
  return {
    completedAtMs,
    output: sanitizeSchedulerReportText(completion.output),
    conversationId: completion.conversationId?.trim().slice(0, 256) || undefined,
    conversationDurable: completion.conversationDurable !== false,
    warnings: Array.isArray(completion.warnings)
      ? completion.warnings
          .filter((warning): warning is string => typeof warning === 'string')
          .slice(0, 10)
          .map((warning) => sanitizeSchedulerReportText(warning))
      : undefined,
  };
}

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteTimestamp(value: unknown): number | undefined {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined) return undefined;
  return parsed > 0 ? Math.floor(parsed) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined || parsed < 1) return undefined;
  return Math.floor(parsed);
}

export function normalizeTerminalReports(value: unknown): SchedulerTerminalReport[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((report): report is SchedulerTerminalReport =>
      Boolean(
        report &&
        typeof report.id === 'string' &&
        report.id.length > 0 &&
        report.id.length <= 256 &&
        typeof report.jobId === 'string' &&
        report.jobId.length > 0 &&
        report.jobId.length <= 256 &&
        typeof report.jobName === 'string' &&
        Number.isFinite(report.startedAtMs) &&
        Number.isFinite(report.completedAtMs) &&
        Number.isInteger(report.attempt) &&
        report.attempt > 0 &&
        (report.status === 'success' ||
          report.status === 'error' ||
          report.status === 'retrying') &&
        (report.notification === 'success' ||
          report.notification === 'failure' ||
          report.notification === 'none'),
      ),
    )
    .map(sanitizeSchedulerTerminalReport);
}

function withStableEveryAnchor(schedule: CronSchedule, nowMs: number): CronSchedule {
  if (schedule.kind !== 'every') return schedule;
  const anchorMs = finiteTimestamp(schedule.anchorMs);
  return anchorMs === undefined ? { ...schedule, anchorMs: nowMs } : schedule;
}

export function safeComputeNextRunAtMs(schedule: CronSchedule, nowMs: number): number | undefined {
  try {
    return finiteTimestamp(computeNextRunAtMs(schedule, nowMs));
  } catch {
    return undefined;
  }
}

export function prepareScheduleRuntime(schedule: CronSchedule, nowMs: number) {
  const stableSchedule = withStableEveryAnchor(schedule, nowMs);
  return {
    schedule: stableSchedule,
    nextRunAtMs: safeComputeNextRunAtMs(stableSchedule, nowMs),
  };
}

export function haveSameFlatFields(left: object, right: object): boolean {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of keys) {
    if (!Object.is(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

export function shouldDisableAfterRun(job: CronJob): boolean {
  return job.schedule.kind === 'at' || job.deleteAfterRun === true;
}

export function normalizePersistedJob(job: CronJob, nowMs: number): CronJob {
  const cleanJob = { ...job } as CronJob & { lastAmbiguousReportedAttemptId?: unknown };
  delete cleanJob.lastAmbiguousReportedAttemptId;
  const scheduleRuntime = prepareScheduleRuntime(job.schedule, job.createdAtMs || nowMs);
  return {
    ...cleanJob,
    definitionRevision: positiveInteger(job.definitionRevision) ?? 1,
    payload: {
      ...job.payload,
      mode: job.payload?.mode === 'chitchat' ? 'chitchat' : 'agentic',
    },
    schedule: scheduleRuntime.schedule,
    nextRunAtMs: finiteTimestamp(job.nextRunAtMs) ?? scheduleRuntime.nextRunAtMs,
    lastRunAtMs: finiteTimestamp(job.lastRunAtMs),
    lastAttemptAtMs: finiteTimestamp(job.lastAttemptAtMs),
    lastSuccessAtMs: finiteTimestamp(job.lastSuccessAtMs),
    lastFailureAtMs: finiteTimestamp(job.lastFailureAtMs),
    lastError:
      typeof job.lastError === 'string' ? sanitizeSchedulerReportText(job.lastError) : undefined,
    retryAttempts: normalizeSchedulerRetryAttempts(job.retryAttempts),
    nextRetryAtMs: finiteTimestamp(job.nextRetryAtMs),
    retryConversationId: job.retryConversationId?.trim() || undefined,
    retryOccurrenceId: job.retryOccurrenceId?.trim() || undefined,
    runningAttemptId: job.runningAttemptId?.trim() || undefined,
    runningStartedAtMs: finiteTimestamp(job.runningStartedAtMs),
    runningDefinitionRevision: job.runningAttemptId
      ? (positiveInteger(job.runningDefinitionRevision) ??
        positiveInteger(job.definitionRevision) ??
        1)
      : undefined,
    runningAttemptNumber: job.runningAttemptId
      ? (positiveInteger(job.runningAttemptNumber) ??
        normalizeSchedulerRetryAttempts(job.retryAttempts) + 1)
      : undefined,
    runningConversationId: job.runningAttemptId
      ? job.runningConversationId?.trim() || undefined
      : undefined,
    runningEffectRisk:
      job.runningAttemptId && job.runningEffectRisk === 'safe'
        ? 'safe'
        : job.runningAttemptId && job.runningEffectRisk === 'unsafe'
          ? 'unsafe'
          : undefined,
    runningOccurrenceId: job.runningAttemptId
      ? job.runningOccurrenceId?.trim() || job.runningAttemptId?.trim() || undefined
      : undefined,
    runningCompletion: job.runningAttemptId
      ? normalizeRunningCompletion(job.runningCompletion)
      : undefined,
    lastAmbiguousAttemptId: job.lastAmbiguousAttemptId?.trim() || undefined,
    lastAmbiguousAtMs: finiteTimestamp(job.lastAmbiguousAtMs),
    lastAmbiguousStartedAtMs: finiteTimestamp(job.lastAmbiguousStartedAtMs),
    lastAmbiguousAttemptNumber: positiveInteger(job.lastAmbiguousAttemptNumber),
    lastDeliveryError:
      typeof job.lastDeliveryError === 'string' && job.lastDeliveryError.trim()
        ? sanitizeSchedulerReportText(job.lastDeliveryError)
        : undefined,
    lastDeliveryFailureAtMs: finiteTimestamp(job.lastDeliveryFailureAtMs),
    lastSettledAttemptId: job.lastSettledAttemptId?.trim() || undefined,
    pendingWakeNotificationId: job.pendingWakeNotificationId,
    pendingWakeNotificationRunAtMs: finiteTimestamp(job.pendingWakeNotificationRunAtMs),
    pendingWakeNotificationTitle: job.pendingWakeNotificationTitle?.trim() || undefined,
    lastWakeAtMs: finiteTimestamp(job.lastWakeAtMs),
    lastWakeSource: job.lastWakeSource,
    lastWakeError: job.lastWakeError?.trim() || undefined,
    lastWakeFailureAtMs: finiteTimestamp(job.lastWakeFailureAtMs),
    wakePolicy: job.wakePolicy === 'active_only' ? 'active_only' : 'notify_only',
  };
}

export function clearRetryState(job: CronJob): CronJob {
  return {
    ...job,
    retryAttempts: 0,
    nextRetryAtMs: undefined,
    retryConversationId: undefined,
    retryOccurrenceId: undefined,
  };
}

export function appendTerminalReport(
  reports: SchedulerTerminalReport[],
  report: SchedulerTerminalReport,
): SchedulerTerminalReport[] {
  return [...reports.filter((candidate) => candidate.id !== report.id), report];
}

export function terminalizeStrandedAttempt(job: CronJob, timestamp: number): CronJob {
  const definitionChanged = job.runningDefinitionRevision !== job.definitionRevision;
  const disable = shouldDisableAfterRun(job);
  return {
    ...job,
    enabled: definitionChanged ? job.enabled : disable ? false : job.enabled,
    updatedAtMs: Date.now(),
    lastRunAtMs: timestamp,
    lastFailureAtMs: timestamp,
    lastError:
      'A previous scheduled attempt ended without a durable terminal record; replay was suppressed.',
    retryAttempts: 0,
    nextRetryAtMs: undefined,
    retryConversationId: undefined,
    retryOccurrenceId: undefined,
    lastAmbiguousAttemptId: job.runningAttemptId,
    lastAmbiguousAtMs: timestamp,
    lastAmbiguousStartedAtMs: job.runningStartedAtMs,
    lastAmbiguousAttemptNumber:
      positiveInteger(job.runningAttemptNumber) ??
      normalizeSchedulerRetryAttempts(job.retryAttempts) + 1,
    lastSettledAttemptId: job.runningAttemptId,
    runningAttemptId: undefined,
    runningStartedAtMs: undefined,
    runningDefinitionRevision: undefined,
    runningAttemptNumber: undefined,
    runningConversationId: undefined,
    runningEffectRisk: undefined,
    runningOccurrenceId: undefined,
    runningCompletion: undefined,
    nextRunAtMs: definitionChanged
      ? job.nextRunAtMs
      : disable
        ? undefined
        : safeComputeNextRunAtMs(job.schedule, timestamp),
  };
}

export const SAFE_INTERRUPTION_RETRY_MESSAGE =
  'A previous scheduled attempt stopped before any durable effect was claimed; it is safe to retry.';

export function canRetrySafelyInterruptedAttempt(job: CronJob): boolean {
  return job.enabled && job.runningDefinitionRevision === job.definitionRevision;
}

export function deferSafelyInterruptedAttempt(job: CronJob, timestamp: number): CronJob {
  const canRetry = canRetrySafelyInterruptedAttempt(job);
  return {
    ...job,
    updatedAtMs: Date.now(),
    lastAttemptAtMs: timestamp,
    lastError: canRetry ? SAFE_INTERRUPTION_RETRY_MESSAGE : job.lastError,
    lastSettledAttemptId: job.runningAttemptId,
    retryAttempts: canRetry ? normalizeSchedulerRetryAttempts(job.retryAttempts) : 0,
    nextRetryAtMs: canRetry ? timestamp : undefined,
    retryConversationId: canRetry
      ? (job.runningConversationId ?? job.retryConversationId)
      : undefined,
    retryOccurrenceId: canRetry ? (job.runningOccurrenceId ?? job.runningAttemptId) : undefined,
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

export function completeStrandedAttempt(job: CronJob): CronJob {
  const completion = job.runningCompletion;
  if (!completion) return terminalizeStrandedAttempt(job, Date.now());
  const definitionChanged = job.runningDefinitionRevision !== job.definitionRevision;
  const disable = shouldDisableAfterRun(job);
  return {
    ...job,
    enabled: definitionChanged ? job.enabled : disable ? false : job.enabled,
    updatedAtMs: Date.now(),
    lastRunAtMs: completion.completedAtMs,
    lastAttemptAtMs: completion.completedAtMs,
    lastSuccessAtMs: completion.completedAtMs,
    lastError: undefined,
    lastDeliveryError: undefined,
    lastDeliveryFailureAtMs: undefined,
    lastSettledAttemptId: job.runningAttemptId,
    retryAttempts: 0,
    nextRetryAtMs: undefined,
    retryConversationId: undefined,
    retryOccurrenceId: undefined,
    runningAttemptId: undefined,
    runningStartedAtMs: undefined,
    runningDefinitionRevision: undefined,
    runningAttemptNumber: undefined,
    runningConversationId: undefined,
    runningEffectRisk: undefined,
    runningOccurrenceId: undefined,
    runningCompletion: undefined,
    nextRunAtMs: definitionChanged
      ? job.nextRunAtMs
      : disable
        ? undefined
        : safeComputeNextRunAtMs(job.schedule, completion.completedAtMs),
  };
}
