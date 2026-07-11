import type { CronJob } from '../cron/types';
import { computeNextRunAtMs } from '../cron/schedule';

const SCHEDULER_CHECK_INTERVAL_MS = 60_000;

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

export function normalizeSchedulerRetryAttempts(value: unknown): number {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
}

function resolveJobNextRunAtMs(job: CronJob, nowMs: number): number | undefined {
  const persisted = normalizePositiveTimestamp(job.nextRunAtMs);
  if (persisted !== undefined) return persisted;

  try {
    return normalizePositiveTimestamp(
      computeNextRunAtMs(job.schedule, nowMs - SCHEDULER_CHECK_INTERVAL_MS),
    );
  } catch {
    return undefined;
  }
}

export function shouldRunScheduledJob(job: CronJob, nowMs: number, force: boolean): boolean {
  if (!force && !job.enabled) return false;
  if (job.runningAttemptId) return false;

  const nextRetryAtMs = normalizePositiveTimestamp(job.nextRetryAtMs);
  if (nextRetryAtMs !== undefined) {
    return force || nowMs >= nextRetryAtMs;
  }

  const nextRunAtMs = resolveJobNextRunAtMs(job, nowMs);
  return force || (nextRunAtMs !== undefined && nextRunAtMs <= nowMs);
}
