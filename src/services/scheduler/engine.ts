// ---------------------------------------------------------------------------
// Kavi — Scheduler Engine
// ---------------------------------------------------------------------------
// Evaluates scheduled jobs with persisted next-run, retry, and attempt state.

import { useSchedulerStore } from './store';
import { useExecutionTraceStore, type ExecutionTrace } from './traceStore';
import { syncSchedulerWakeNotifications } from './wakeNotifications';
import type { CronJob, SchedulerTrigger } from '../cron/types';
import { emitSchedulerEvent } from '../events/bus';
import { generateId } from '../../utils/id';
import { unrefTimerIfSupported } from '../../utils/timers';
import { isNonRetryableSchedulerExecutionError } from './executionError';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { ensureSchedulerRuntimeReady } from './runtimeReadiness';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerStartPromise: Promise<void> | null = null;
let schedulerStartRequested = false;
const CHECK_INTERVAL_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;

export interface SchedulerExecutor {
  execute: (job: CronJob) => Promise<string>;
  onSuccess?: (job: CronJob, result: string) => Promise<void>;
  onFinalFailure?: (job: CronJob, error: unknown) => Promise<void>;
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
  | {
      status: 'skipped' | 'succeeded' | 'retrying' | 'failed';
      id: string;
      name: string;
    };

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

function maxRetriesForJob(job: CronJob): number {
  if (job.failureAlert?.enabled === false) return 0;
  const configured = coerceFiniteNumber(job.failureAlert?.maxRetries);
  if (configured === undefined) return DEFAULT_MAX_RETRIES;
  return Math.max(0, Math.floor(configured));
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
): Promise<'skipped' | 'succeeded' | 'retrying' | 'failed'> {
  await ensureSchedulerRuntimeReady();

  const store = useSchedulerStore.getState();
  const attemptId = `attempt-${generateId()}`;
  const claim = store.tryClaimJobAttempt({
    id: job.id,
    attemptId,
    timestamp: nowMs,
    force,
  });
  if (!claim) {
    return 'skipped';
  }
  const { job: claimedJob, attempt } = claim;

  try {
    await flushSchedulerStorePersistenceNow();
  } catch (claimPersistenceError) {
    const error = `Unable to persist the scheduled attempt claim: ${
      claimPersistenceError instanceof Error
        ? claimPersistenceError.message
        : String(claimPersistenceError)
    }`;
    const settlementRecorded = store.recordRunFailure(claimedJob.id, attemptId, {
      timestamp: Date.now(),
      error,
      attempt,
      final: true,
    });
    if (!settlementRecorded) return 'failed';
    await flushSchedulerStorePersistenceNow().catch(() => undefined);
    emitSchedulerEvent('task_failed', { taskId: claimedJob.id, error });
    recordTrace({
      jobId: claimedJob.id,
      jobName: claimedJob.name,
      status: 'error',
      startedAt: nowMs,
      completedAt: Date.now(),
      error,
      attempt,
      trigger,
    });
    return 'failed';
  }

  if (store.getJob(claimedJob.id)?.runningAttemptId !== attemptId) {
    return 'skipped';
  }

  emitSchedulerEvent('task_run', { taskId: claimedJob.id, taskName: claimedJob.name });
  const jobExecutor = executor;
  const startMs = Date.now();

  if (!jobExecutor) {
    const error = 'No executor configured';
    const completedAt = Date.now();
    const settlementRecorded = store.recordRunFailure(claimedJob.id, attemptId, {
      timestamp: completedAt,
      error,
      attempt,
      final: true,
    });
    if (!settlementRecorded) return 'failed';
    try {
      await flushSchedulerStorePersistenceNow();
    } catch (persistenceError) {
      store.restoreJobAttemptClaim({
        id: claimedJob.id,
        attemptId,
        startedAtMs: nowMs,
      });
      console.warn('[scheduler] Failed to persist missing-executor settlement:', persistenceError);
    }
    emitSchedulerEvent('task_failed', { taskId: claimedJob.id, error });
    recordTrace({
      jobId: claimedJob.id,
      jobName: claimedJob.name,
      status: 'error',
      startedAt: startMs,
      completedAt,
      error,
      attempt,
      trigger,
    });
    return 'failed';
  }

  try {
    const result = await jobExecutor.execute(claimedJob);
    const completedAt = Date.now();
    if (!store.recordRun(claimedJob.id, attemptId, completedAt)) {
      return 'failed';
    }
    try {
      await flushSchedulerStorePersistenceNow();
    } catch (persistenceError) {
      const error = `Scheduled work completed, but terminal scheduler state could not be persisted: ${
        persistenceError instanceof Error ? persistenceError.message : String(persistenceError)
      }`;
      store.restoreJobAttemptClaim({
        id: claimedJob.id,
        attemptId,
        startedAtMs: nowMs,
        error,
      });
      emitSchedulerEvent('task_failed', { taskId: claimedJob.id, error });
      recordTrace({
        jobId: claimedJob.id,
        jobName: claimedJob.name,
        status: 'error',
        startedAt: startMs,
        completedAt,
        error,
        attempt,
        trigger,
      });
      return 'failed';
    }

    emitSchedulerEvent('task_complete', {
      taskId: claimedJob.id,
      taskName: claimedJob.name,
    });
    await jobExecutor
      .onSuccess?.(claimedJob, result)
      .catch((notificationError) =>
        console.warn('[scheduler] Success notification failed:', notificationError),
      );
    recordTrace({
      jobId: claimedJob.id,
      jobName: claimedJob.name,
      status: 'success',
      startedAt: startMs,
      completedAt,
      output: result,
      trigger,
    });
    return 'succeeded';
  } catch (err: unknown) {
    const completedAt = Date.now();
    const error = err instanceof Error ? err.message : String(err);
    const maxRetries = force && !claimedJob.enabled ? 0 : maxRetriesForJob(claimedJob);
    const willRetry = !isNonRetryableSchedulerExecutionError(err) && attempt <= maxRetries;

    if (willRetry) {
      const nextRetryAtMs = completedAt + getRetryDelay(attempt);
      const settlementRecorded = store.recordRunFailure(claimedJob.id, attemptId, {
        timestamp: completedAt,
        error,
        attempt,
        nextRetryAtMs,
        final: false,
      });
      if (!settlementRecorded) return 'failed';
      try {
        await flushSchedulerStorePersistenceNow();
      } catch (persistenceError) {
        store.restoreJobAttemptClaim({
          id: claimedJob.id,
          attemptId,
          startedAtMs: nowMs,
        });
        console.warn('[scheduler] Failed to persist retry settlement:', persistenceError);
        return 'failed';
      }
      emitSchedulerEvent('task_retrying', {
        taskId: claimedJob.id,
        error,
        attempt,
        maxRetries,
      });
      recordTrace({
        jobId: claimedJob.id,
        jobName: claimedJob.name,
        status: 'retrying',
        startedAt: startMs,
        completedAt,
        error,
        attempt,
        trigger,
      });
      return 'retrying';
    }

    const settlementRecorded = store.recordRunFailure(claimedJob.id, attemptId, {
      timestamp: completedAt,
      error,
      attempt,
      final: true,
    });
    if (!settlementRecorded) return 'failed';
    try {
      await flushSchedulerStorePersistenceNow();
    } catch (persistenceError) {
      store.restoreJobAttemptClaim({
        id: claimedJob.id,
        attemptId,
        startedAtMs: nowMs,
      });
      console.warn('[scheduler] Failed to persist final failure settlement:', persistenceError);
      return 'failed';
    }
    emitSchedulerEvent('task_failed', { taskId: claimedJob.id, error });
    await jobExecutor
      .onFinalFailure?.(claimedJob, err)
      .catch((notificationError) =>
        console.warn('[scheduler] Final failure notification failed:', notificationError),
      );
    recordTrace({
      jobId: claimedJob.id,
      jobName: claimedJob.name,
      status: 'error',
      startedAt: startMs,
      completedAt,
      error,
      attempt,
      trigger,
    });
    return 'failed';
  }
}

async function evaluateJobs(options: EvaluateJobsOptions = {}): Promise<void> {
  await ensureSchedulerRuntimeReady();
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
  await syncSchedulerWakeNotifications({ nowMs, force: false }).catch((error) =>
    console.warn('[scheduler] Wake notification maintenance failed:', error),
  );
}

export function startScheduler(): Promise<void> {
  schedulerStartRequested = true;
  if (schedulerInterval) return Promise.resolve();
  if (schedulerStartPromise) return schedulerStartPromise;

  schedulerStartPromise = ensureSchedulerRuntimeReady()
    .then(async () => {
      if (!schedulerStartRequested || schedulerInterval) return;
      schedulerInterval = setInterval(() => {
        void evaluateJobs({ trigger: 'scheduled' }).catch(console.error);
      }, CHECK_INTERVAL_MS);
      unrefTimerIfSupported(schedulerInterval);
      await evaluateJobs({ trigger: 'scheduled' });
    })
    .finally(() => {
      schedulerStartPromise = null;
    });
  return schedulerStartPromise;
}

/** Run a single evaluation pass. Used by background tasks and lifecycle hooks. */
export async function evaluateJobsOnce(options: EvaluateJobsOptions = {}): Promise<void> {
  return evaluateJobs(options);
}

export async function runJobNow(
  jobId: string,
  options: Omit<EvaluateJobsOptions, 'targetJobId' | 'force'> = {},
): Promise<RunJobNowResult> {
  await ensureSchedulerRuntimeReady();
  const job = useSchedulerStore.getState().getJob(jobId);
  if (!job) return { status: 'not_found', id: jobId };

  const nowMs = options.nowMs ?? Date.now();
  const result = await executeJob(job, nowMs, options.trigger ?? 'manual', true);
  await syncSchedulerWakeNotifications({ nowMs, force: false }).catch((error) =>
    console.warn('[scheduler] Wake notification maintenance failed:', error),
  );
  return { status: result, id: job.id, name: job.name };
}

export function stopScheduler(): void {
  schedulerStartRequested = false;
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/** Reset retry state for a specific job (e.g., after manual edit). */
export function resetJobRetry(jobId: string): void {
  useSchedulerStore.getState().resetJobRetry(jobId);
}
