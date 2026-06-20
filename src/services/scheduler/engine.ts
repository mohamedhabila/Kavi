// ---------------------------------------------------------------------------
// Kavi — Scheduler Engine
// ---------------------------------------------------------------------------
// Evaluates scheduled jobs with persisted next-run, retry, and attempt state.

import { computeNextRunAtMs } from '../cron/schedule';
import { useSchedulerStore } from './store';
import { useExecutionTraceStore, type ExecutionTrace } from './traceStore';
import type { CronJob, SchedulerTrigger } from '../cron/types';
import { emitSchedulerEvent } from '../events/bus';
import { generateId } from '../../utils/id';
import { unrefTimerIfSupported } from '../../utils/timers';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 60_000;
const ATTEMPT_LEASE_MS = 10 * 60_000;
const DEFAULT_MAX_RETRIES = 2;

export interface SchedulerExecutor {
  execute: (job: CronJob) => Promise<string>;
}

export interface EvaluateJobsOptions {
  nowMs?: number;
  trigger?: SchedulerTrigger;
  targetJobId?: string;
  force?: boolean;
  timeBudgetMs?: number;
}

export type RunJobNowResult =
  | { status: 'not_found'; id: string }
  | { status: 'skipped'; id: string; name: string }
  | { status: 'completed'; id: string; name: string };

let executor: SchedulerExecutor | null = null;

export function setSchedulerExecutor(exec: SchedulerExecutor | null): void {
  executor = exec;
}

// ── Retry logic ──────────────────────────────────────────────────────────

function getRetryDelay(attempt: number): number {
  // Exponential backoff: 30s, 60s, 120s, 240s, cap at 5 min.
  const base = 30_000;
  return Math.min(base * Math.pow(2, attempt - 1), 5 * 60_000);
}

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePositiveTimestamp(value: unknown): number | undefined {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function normalizeRetryAttempts(value: unknown): number {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
}

function maxRetriesForJob(job: CronJob): number {
  if (job.failureAlert?.enabled === false) return 0;
  const configured = coerceFiniteNumber(job.failureAlert?.maxRetries);
  if (configured === undefined) return DEFAULT_MAX_RETRIES;
  return Math.max(0, Math.floor(configured));
}

function resolveJobNextRunAtMs(job: CronJob, nowMs: number): number | undefined {
  const persisted = normalizePositiveTimestamp(job.nextRunAtMs);
  if (persisted !== undefined) return persisted;

  try {
    return normalizePositiveTimestamp(computeNextRunAtMs(job.schedule, nowMs - CHECK_INTERVAL_MS));
  } catch {
    return undefined;
  }
}

function hasActiveAttempt(job: CronJob, nowMs: number): boolean {
  if (!job.runningAttemptId) return false;
  const startedAtMs = normalizePositiveTimestamp(job.runningStartedAtMs);
  return startedAtMs !== undefined && nowMs - startedAtMs < ATTEMPT_LEASE_MS;
}

function shouldRunJob(job: CronJob, nowMs: number, force: boolean): boolean {
  if (!force && !job.enabled) return false;
  if (hasActiveAttempt(job, nowMs)) return false;

  const nextRetryAtMs = normalizePositiveTimestamp(job.nextRetryAtMs);
  if (nextRetryAtMs !== undefined) {
    return force || nowMs >= nextRetryAtMs;
  }

  const nextRunAtMs = resolveJobNextRunAtMs(job, nowMs);
  return force || (nextRunAtMs !== undefined && nextRunAtMs <= nowMs);
}

// ── Execution trace recording ───────────────────────────────────────────

function recordTrace(params: {
  jobId: string;
  jobName: string;
  status: ExecutionTrace['status'];
  startedAt: number;
  completedAt: number;
  output?: string;
  error?: string;
  attempt?: number;
  trigger: SchedulerTrigger;
}): void {
  useExecutionTraceStore.getState().addTrace({
    id: `trace-${generateId()}`,
    jobId: params.jobId,
    jobName: params.jobName,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    durationMs: Math.max(0, params.completedAt - params.startedAt),
    status: params.status,
    output: params.output?.slice(0, 2000),
    error: params.error,
    attempt: params.attempt,
    trigger: params.trigger,
  });
}

// ── Core evaluation ─────────────────────────────────────────────────────

async function executeJob(
  job: CronJob,
  nowMs: number,
  trigger: SchedulerTrigger,
  force: boolean,
): Promise<'completed' | 'skipped'> {
  const store = useSchedulerStore.getState();
  if (!shouldRunJob(job, nowMs, force)) {
    return 'skipped';
  }

  const attempt = normalizeRetryAttempts(job.retryAttempts) + 1;
  const attemptId = `attempt-${generateId()}`;
  store.markJobAttemptStarted(job.id, attemptId, nowMs);
  emitSchedulerEvent('task_run', { taskId: job.id, taskName: job.name });

  if (!executor) {
    const error = 'No executor configured';
    store.updateJobRuntimeState(job.id, {
      lastAttemptAtMs: nowMs,
      lastFailureAtMs: nowMs,
      lastError: error,
      runningAttemptId: undefined,
      runningStartedAtMs: undefined,
    });
    emitSchedulerEvent('task_failed', { taskId: job.id, error });
    recordTrace({
      jobId: job.id,
      jobName: job.name,
      status: 'error',
      startedAt: nowMs,
      completedAt: nowMs,
      error,
      attempt,
      trigger,
    });
    return 'completed';
  }

  const startMs = Date.now();
  try {
    const result = await executor.execute(job);
    const completedAt = Date.now();
    store.recordRun(job.id, completedAt);
    emitSchedulerEvent('task_complete', { taskId: job.id, taskName: job.name });
    recordTrace({
      jobId: job.id,
      jobName: job.name,
      status: 'success',
      startedAt: startMs,
      completedAt,
      output: result,
      trigger,
    });
    return 'completed';
  } catch (err: unknown) {
    const completedAt = Date.now();
    const error = err instanceof Error ? err.message : String(err);
    const maxRetries = maxRetriesForJob(job);
    const willRetry = attempt < maxRetries;

    if (willRetry) {
      const nextRetryAtMs = completedAt + getRetryDelay(attempt);
      store.recordRunFailure(job.id, {
        timestamp: completedAt,
        error,
        attempt,
        nextRetryAtMs,
        final: false,
      });
      emitSchedulerEvent('task_failed', {
        taskId: job.id,
        error: `${error} (retry ${attempt}/${maxRetries})`,
      });
      recordTrace({
        jobId: job.id,
        jobName: job.name,
        status: 'retrying',
        startedAt: startMs,
        completedAt,
        error,
        attempt,
        trigger,
      });
      return 'completed';
    }

    store.recordRunFailure(job.id, {
      timestamp: completedAt,
      error,
      attempt,
      final: true,
    });
    emitSchedulerEvent('task_failed', { taskId: job.id, error });
    recordTrace({
      jobId: job.id,
      jobName: job.name,
      status: 'error',
      startedAt: startMs,
      completedAt,
      error,
      attempt,
      trigger,
    });
    return 'completed';
  }
}

async function evaluateJobs(options: EvaluateJobsOptions = {}): Promise<void> {
  const startedAtMs = Date.now();
  const nowMs = options.nowMs ?? startedAtMs;
  const trigger = options.trigger ?? 'scheduled';
  const store = useSchedulerStore.getState();
  const candidates = options.targetJobId
    ? store.jobs.filter((job) => job.id === options.targetJobId)
    : store.getEnabledJobs();

  for (const job of candidates) {
    if (
      options.timeBudgetMs !== undefined &&
      Date.now() - startedAtMs >= Math.max(0, options.timeBudgetMs)
    ) {
      break;
    }
    await executeJob(job, nowMs, trigger, options.force === true);
  }

  store.recordEvaluation(nowMs, trigger);
}

export function startScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    void evaluateJobs({ trigger: 'scheduled' }).catch(console.error);
  }, CHECK_INTERVAL_MS);
  unrefTimerIfSupported(schedulerInterval);
  void evaluateJobs({ trigger: 'scheduled' }).catch(console.error);
}

/** Run a single evaluation pass. Used by background tasks and lifecycle hooks. */
export async function evaluateJobsOnce(options: EvaluateJobsOptions = {}): Promise<void> {
  return evaluateJobs(options);
}

export async function runJobNow(
  jobId: string,
  options: Omit<EvaluateJobsOptions, 'targetJobId' | 'force'> = {},
): Promise<RunJobNowResult> {
  const job = useSchedulerStore.getState().getJob(jobId);
  if (!job) return { status: 'not_found', id: jobId };

  const result = await executeJob(
    job,
    options.nowMs ?? Date.now(),
    options.trigger ?? 'manual',
    true,
  );
  return result === 'skipped'
    ? { status: 'skipped', id: job.id, name: job.name }
    : { status: 'completed', id: job.id, name: job.name };
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/** Reset retry state for a specific job (e.g., after manual edit). */
export function resetJobRetry(jobId: string): void {
  useSchedulerStore.getState().resetJobRetry(jobId);
}
