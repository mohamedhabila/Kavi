// ---------------------------------------------------------------------------
// Kavi — Scheduler Engine (Enhanced)
// ---------------------------------------------------------------------------
// Evaluates cron jobs with missed-run recovery, retry with exponential
// backoff, and execution trace recording.

import { computeNextRunAtMs } from '../cron/schedule';
import { useSchedulerStore } from './store';
import { useExecutionTraceStore, type ExecutionTrace } from './traceStore';
import type { CronJob } from '../cron/types';
import { emitSchedulerEvent } from '../events/bus';
import { generateId } from '../../utils/id';
import { unrefTimerIfSupported } from '../../utils/timers';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 60_000; // Check every minute

export interface SchedulerExecutor {
  execute: (job: CronJob) => Promise<string>;
}

let executor: SchedulerExecutor | null = null;

export function setSchedulerExecutor(exec: SchedulerExecutor): void {
  executor = exec;
}

// ── Retry logic ──────────────────────────────────────────────────────────

const retryState = new Map<string, { attempts: number; nextRetryAt: number }>();

function getRetryDelay(attempt: number): number {
  // Exponential backoff: 30s, 60s, 120s, 240s, cap at 5 min
  const base = 30_000;
  return Math.min(base * Math.pow(2, attempt - 1), 5 * 60_000);
}

function canRetry(jobId: string, maxRetries: number): boolean {
  const state = retryState.get(jobId);
  if (!state) return true;
  return state.attempts < maxRetries;
}

function shouldRetryNow(jobId: string): boolean {
  const state = retryState.get(jobId);
  if (!state) return true;
  return Date.now() >= state.nextRetryAt;
}

function recordRetryAttempt(jobId: string): number {
  const current = retryState.get(jobId);
  const attempts = (current?.attempts ?? 0) + 1;
  const nextRetryAt = Date.now() + getRetryDelay(attempts);
  retryState.set(jobId, { attempts, nextRetryAt });
  return attempts;
}

function clearRetryState(jobId: string): void {
  retryState.delete(jobId);
}

// ── Missed-run detection ─────────────────────────────────────────────────

let lastEvaluationMs = 0;

/**
 * Detects jobs that should have run during a period when the scheduler was
 * not active (e.g., app was backgrounded). Compares last evaluation time
 * to now and checks for any missed windows.
 */
function detectMissedRuns(enabledJobs: CronJob[], nowMs: number): CronJob[] {
  if (lastEvaluationMs === 0) return [];
  const gapMs = nowMs - lastEvaluationMs;
  // Only look for missed runs if gap > 1.5× check interval (app was backgrounded)
  if (gapMs < CHECK_INTERVAL_MS * 1.5) return [];

  const missed: CronJob[] = [];
  for (const job of enabledJobs) {
    const nextRun = computeNextRunAtMs(job.schedule, lastEvaluationMs);
    if (nextRun !== undefined && nextRun <= nowMs && nextRun > lastEvaluationMs) {
      missed.push(job);
    }
  }
  return missed;
}

// ── Execution trace recording ───────────────────────────────────────────

function recordTrace(
  jobId: string,
  jobName: string,
  status: ExecutionTrace['status'],
  durationMs: number,
  output?: string,
  error?: string,
  attempt?: number,
): void {
  useExecutionTraceStore.getState().addTrace({
    id: `trace-${generateId()}`,
    jobId,
    jobName,
    startedAt: Date.now() - durationMs,
    completedAt: Date.now(),
    durationMs,
    status,
    output: output?.slice(0, 2000),
    error,
    attempt,
    trigger: lastEvaluationMs === 0 ? 'manual' : 'scheduled',
  });
}

// ── Core evaluation ─────────────────────────────────────────────────────

async function executeJob(
  job: CronJob,
  nowMs: number,
  trigger: 'scheduled' | 'missed-recovery',
): Promise<void> {
  const store = useSchedulerStore.getState();
  const maxRetries = job.failureAlert?.maxRetries ?? 2;

  emitSchedulerEvent('task_run', { taskId: job.id, taskName: job.name });

  if (!executor) {
    emitSchedulerEvent('task_failed', { taskId: job.id, error: 'No executor configured' });
    recordTrace(job.id, job.name, 'error', 0, undefined, 'No executor configured');
    return;
  }

  const startMs = Date.now();
  try {
    const result = await executor.execute(job);
    const durationMs = Date.now() - startMs;
    store.recordRun(job.id, nowMs);
    clearRetryState(job.id);
    emitSchedulerEvent('task_complete', { taskId: job.id, taskName: job.name });
    recordTrace(job.id, job.name, 'success', durationMs, result);
  } catch (err: unknown) {
    const durationMs = Date.now() - startMs;
    const attempt = recordRetryAttempt(job.id);

    if (canRetry(job.id, maxRetries)) {
      emitSchedulerEvent('task_failed', {
        taskId: job.id,
        error: `${err instanceof Error ? err.message : String(err)} (retry ${attempt}/${maxRetries})`,
      });
      recordTrace(
        job.id,
        job.name,
        'retrying',
        durationMs,
        undefined,
        err instanceof Error ? err.message : String(err),
        attempt,
      );
    } else {
      emitSchedulerEvent('task_failed', {
        taskId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
      recordTrace(
        job.id,
        job.name,
        'error',
        durationMs,
        undefined,
        err instanceof Error ? err.message : String(err),
        attempt,
      );
      clearRetryState(job.id);
      // Record final failed run so it doesn't re-trigger
      store.recordRun(job.id, nowMs);
    }
  }
}

async function evaluateJobs(): Promise<void> {
  const store = useSchedulerStore.getState();
  const enabledJobs = store.getEnabledJobs();
  const nowMs = Date.now();

  // Check for missed runs from app backgrounding
  const missedJobs = detectMissedRuns(enabledJobs, nowMs);
  for (const job of missedJobs) {
    await executeJob(job, nowMs, 'missed-recovery');
  }

  // Regular evaluation
  for (const job of enabledJobs) {
    // Skip if this job was already handled as a missed run
    if (missedJobs.some((m) => m.id === job.id)) continue;

    // Check retry cooldown
    if (retryState.has(job.id) && !shouldRetryNow(job.id)) continue;

    const nextRun = computeNextRunAtMs(job.schedule, nowMs - CHECK_INTERVAL_MS);
    if (nextRun === undefined) continue;
    if (nextRun > nowMs) continue;

    await executeJob(job, nowMs, 'scheduled');
  }

  lastEvaluationMs = nowMs;

  // Garbage-collect retry state for jobs that no longer exist
  const enabledIds = new Set(enabledJobs.map((j) => j.id));
  for (const id of retryState.keys()) {
    if (!enabledIds.has(id)) retryState.delete(id);
  }
}

export function startScheduler(): void {
  if (schedulerInterval) return;
  lastEvaluationMs = Date.now();
  schedulerInterval = setInterval(evaluateJobs, CHECK_INTERVAL_MS);
  unrefTimerIfSupported(schedulerInterval);
  // Run initial check
  evaluateJobs().catch(console.error);
}

/** Run a single evaluation pass (for background fetch calls). */
export async function evaluateJobsOnce(): Promise<void> {
  return evaluateJobs();
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/** Reset retry state for a specific job (e.g., after manual edit). */
export function resetJobRetry(jobId: string): void {
  clearRetryState(jobId);
}
