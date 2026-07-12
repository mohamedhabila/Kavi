import type { CronJob } from '../cron/types';

const DEFAULT_MAX_RETRIES = 2;

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getSchedulerRetryDelay(attempt: number): number {
  return Math.min(30_000 * Math.pow(2, attempt - 1), 5 * 60_000);
}

export function maxRetriesForScheduledJob(job: CronJob): number {
  if (job.failureAlert?.enabled === false) return 0;
  const configured = coerceFiniteNumber(job.failureAlert?.maxRetries);
  return configured === undefined ? DEFAULT_MAX_RETRIES : Math.max(0, Math.floor(configured));
}
