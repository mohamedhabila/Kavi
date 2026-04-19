// ---------------------------------------------------------------------------
// Kavi — Cron Schedule
// ---------------------------------------------------------------------------

import { Cron } from 'croner';
import { parseAbsoluteTimeMs } from './parse';
import type { CronSchedule } from './types';

const CRON_EVAL_CACHE_MAX = 512;
const cronEvalCache = new Map<string, Cron>();

function resolveCronTimezone(tz?: string) {
  const trimmed = typeof tz === 'string' ? tz.trim() : '';
  return trimmed || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function resolveCachedCron(expr: string, timezone: string): Cron {
  const key = `${timezone}\u0000${expr}`;
  const cached = cronEvalCache.get(key);
  if (cached) return cached;
  if (cronEvalCache.size >= CRON_EVAL_CACHE_MAX) {
    const oldest = cronEvalCache.keys().next().value;
    if (oldest) cronEvalCache.delete(oldest);
  }
  const next = new Cron(expr, { timezone, catch: false });
  cronEvalCache.set(key, next);
  return next;
}

function resolveCronFromSchedule(schedule: {
  tz?: string;
  expr?: unknown;
  cron?: unknown;
}): Cron | undefined {
  const exprSource = typeof schedule.expr === 'string' ? schedule.expr : schedule.cron;
  if (typeof exprSource !== 'string') throw new Error('invalid cron schedule: expr is required');
  const expr = exprSource.trim();
  return expr ? resolveCachedCron(expr, resolveCronTimezone(schedule.tz)) : undefined;
}

export function coerceFiniteScheduleNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function computeNextRunAtMs(schedule: CronSchedule, nowMs: number): number | undefined {
  if (schedule.kind === 'at') {
    const sched = schedule as { at?: string; atMs?: number | string };
    const atMs =
      typeof sched.atMs === 'number' && Number.isFinite(sched.atMs) && sched.atMs > 0
        ? sched.atMs
        : typeof sched.atMs === 'string'
          ? parseAbsoluteTimeMs(sched.atMs)
          : typeof sched.at === 'string'
            ? parseAbsoluteTimeMs(sched.at)
            : null;
    return atMs === null ? undefined : atMs > nowMs ? atMs : undefined;
  }

  if (schedule.kind === 'every') {
    const everyMsRaw = coerceFiniteScheduleNumber(schedule.everyMs);
    if (everyMsRaw === undefined) return undefined;
    const everyMs = Math.max(1, Math.floor(everyMsRaw));
    const anchorRaw = coerceFiniteScheduleNumber(schedule.anchorMs);
    const anchor = Math.max(0, Math.floor(anchorRaw ?? nowMs));
    if (nowMs < anchor) return anchor;
    const elapsed = nowMs - anchor;
    const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
    return anchor + steps * everyMs;
  }

  const cron = resolveCronFromSchedule(schedule as { tz?: string; expr?: unknown; cron?: unknown });
  if (!cron) return undefined;
  const next = cron.nextRun(new Date(nowMs));
  if (!next) return undefined;
  let nextMs = next.getTime();
  if (!Number.isFinite(nextMs)) return undefined;

  if (nextMs <= nowMs) {
    const nextSecondMs = Math.floor(nowMs / 1000) * 1000 + 1000;
    const retry = cron.nextRun(new Date(nextSecondMs));
    if (retry) {
      const retryMs = retry.getTime();
      if (Number.isFinite(retryMs) && retryMs > nowMs) return retryMs;
    }
    const tomorrowMs = new Date(nowMs).setUTCHours(24, 0, 0, 0);
    const retry2 = cron.nextRun(new Date(tomorrowMs));
    if (retry2) {
      const retry2Ms = retry2.getTime();
      if (Number.isFinite(retry2Ms) && retry2Ms > nowMs) return retry2Ms;
    }
    return undefined;
  }

  return nextMs;
}

export function clearCronScheduleCacheForTest(): void {
  cronEvalCache.clear();
}
