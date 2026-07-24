import type { CronJob } from '../cron/types';
import type { ExecutionTrace } from './traceStore';

export type SchedulerJobDisplayState =
  | 'running'
  | 'retrying'
  | 'needs-attention'
  | 'scheduled'
  | 'paused';

export type SchedulerResultDisplayState = 'completed' | 'failed' | 'retrying' | 'interrupted';

export interface SchedulerResultPresentation {
  status: SchedulerResultDisplayState;
  timestamp: number;
  detail?: string;
}

export interface SchedulerJobPresentation {
  state: SchedulerJobDisplayState;
  nextOccurrenceAt?: number;
  latestResult?: SchedulerResultPresentation;
  hasNotificationIssue: boolean;
}

function finitePositiveTimestamp(value: unknown): number | undefined {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0
    ? numeric
    : undefined;
}

function getJobState(job: CronJob): SchedulerJobDisplayState {
  if (job.runningAttemptId) return 'running';
  if (!job.enabled) return 'paused';
  if (finitePositiveTimestamp(job.nextRetryAtMs)) return 'retrying';
  const lastFailureAt = finitePositiveTimestamp(job.lastFailureAtMs);
  const lastSuccessAt = finitePositiveTimestamp(job.lastSuccessAtMs);
  if (job.lastError || (lastFailureAt && (!lastSuccessAt || lastFailureAt >= lastSuccessAt))) {
    return 'needs-attention';
  }
  return 'scheduled';
}

function getTraceResult(trace: ExecutionTrace): SchedulerResultPresentation {
  const status: SchedulerResultDisplayState =
    trace.status === 'success'
      ? 'completed'
      : trace.status === 'error'
        ? 'failed'
        : trace.status === 'retrying'
          ? 'retrying'
          : 'interrupted';
  const detail = trace.error || trace.warnings?.[0];
  return {
    status,
    timestamp: trace.completedAt,
    ...(detail ? { detail } : {}),
  };
}

function getFallbackResult(job: CronJob): SchedulerResultPresentation | undefined {
  const lastSuccessAt = finitePositiveTimestamp(job.lastSuccessAtMs);
  const lastFailureAt = finitePositiveTimestamp(job.lastFailureAtMs);
  if (!lastSuccessAt && !lastFailureAt) return undefined;
  if (lastFailureAt && (!lastSuccessAt || lastFailureAt >= lastSuccessAt)) {
    return {
      status: finitePositiveTimestamp(job.nextRetryAtMs) ? 'retrying' : 'failed',
      timestamp: lastFailureAt,
      ...(job.lastError ? { detail: job.lastError } : {}),
    };
  }
  return { status: 'completed', timestamp: lastSuccessAt as number };
}

export function selectLatestSchedulerTrace(
  traces: readonly ExecutionTrace[],
  jobId: string,
): ExecutionTrace | undefined {
  return traces.reduce<ExecutionTrace | undefined>((latest, trace) => {
    if (trace.jobId !== jobId) return latest;
    if (!latest || trace.completedAt > latest.completedAt) return trace;
    if (trace.completedAt === latest.completedAt && trace.id.localeCompare(latest.id) > 0) {
      return trace;
    }
    return latest;
  }, undefined);
}

export function buildSchedulerJobPresentation(
  job: CronJob,
  traces: readonly ExecutionTrace[],
): SchedulerJobPresentation {
  const latestTrace = selectLatestSchedulerTrace(traces, job.id);
  return {
    state: getJobState(job),
    nextOccurrenceAt:
      finitePositiveTimestamp(job.nextRetryAtMs) ?? finitePositiveTimestamp(job.nextRunAtMs),
    latestResult: latestTrace ? getTraceResult(latestTrace) : getFallbackResult(job),
    hasNotificationIssue: Boolean(job.lastWakeError || job.lastDeliveryError),
  };
}
