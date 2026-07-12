import type { CronJob } from '../cron/types';

export type SchedulerJobExecutionOutcome =
  | {
      status: 'skipped';
      reason:
        | 'job_busy'
        | 'capacity_busy'
        | 'conversation_busy'
        | 'report_backlog'
        | 'recovery_busy'
        | 'inactive'
        | 'ineligible';
    }
  | { status: 'succeeded'; warning?: string }
  | { status: 'retrying' | 'failed'; error: string };

export type RunJobNowResult =
  | { status: 'not_found'; id: string }
  | { status: 'busy'; id: string; name: string; error: string }
  | { status: 'skipped'; id: string; name: string; error: string }
  | { status: 'succeeded'; id: string; name: string; warning?: string }
  | { status: 'retrying' | 'failed'; id: string; name: string; error: string };

function busyReasonMessage(
  reason: Extract<SchedulerJobExecutionOutcome, { status: 'skipped' }>['reason'],
): string {
  if (reason === 'job_busy') return 'The scheduled job already has an active execution.';
  if (reason === 'conversation_busy') {
    return 'Another scheduled task is using this conversation; the job remains due.';
  }
  if (reason === 'report_backlog') {
    return 'Terminal report delivery is backlogged; the scheduled job remains due.';
  }
  if (reason === 'capacity_busy') {
    return 'Scheduled execution capacity is currently full; the job remains due.';
  }
  return 'Foreground recovery is in progress; the scheduled job remains due.';
}

export function buildRunJobNowResult(params: {
  job: CronJob;
  outcome: SchedulerJobExecutionOutcome;
  wakeWarning?: string;
}): RunJobNowResult {
  const { job, outcome, wakeWarning } = params;
  if (outcome.status === 'retrying' || outcome.status === 'failed') {
    return {
      status: outcome.status,
      id: job.id,
      name: job.name,
      error: outcome.error,
    };
  }
  if (outcome.status === 'skipped') {
    const busy =
      outcome.reason === 'job_busy' ||
      outcome.reason === 'capacity_busy' ||
      outcome.reason === 'conversation_busy' ||
      outcome.reason === 'report_backlog' ||
      outcome.reason === 'recovery_busy';
    return busy
      ? {
          status: 'busy',
          id: job.id,
          name: job.name,
          error: busyReasonMessage(outcome.reason),
        }
      : {
          status: 'skipped',
          id: job.id,
          name: job.name,
          error:
            outcome.reason === 'inactive'
              ? 'The app is not active; tap the wake notification in the foreground to run this job.'
              : 'The scheduled job is disabled or is not due yet.',
        };
  }
  if (outcome.status === 'succeeded') {
    const warning = [outcome.warning, wakeWarning].filter(Boolean).join(' ');
    return {
      status: outcome.status,
      id: job.id,
      name: job.name,
      ...(warning ? { warning } : {}),
    };
  }
  throw new Error(`Unhandled scheduled execution result: ${JSON.stringify(outcome)}`);
}
