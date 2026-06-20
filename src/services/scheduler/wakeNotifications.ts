// ---------------------------------------------------------------------------
// Kavi — Scheduler Wake Notifications
// ---------------------------------------------------------------------------
// Schedules local notifications that let users wake the app for due tasks
// when the OS does not grant a background execution window.

import { cancelLocalNotification, sendLocalNotification } from '../notifications/service';
import type { CronJob } from '../cron/types';
import { useSchedulerStore } from './store';

const MIN_WAKE_DELAY_SECONDS = 1;
const PERMISSION_DENIAL_SUPPRESSION_MS = 60 * 60 * 1000;

let suppressWakeSchedulingUntilMs = 0;

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveTimestamp(value: unknown): number | undefined {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function resolveWakeRunAtMs(job: CronJob): number | undefined {
  return positiveTimestamp(job.nextRetryAtMs) ?? positiveTimestamp(job.nextRunAtMs);
}

function hasMatchingPendingWakeNotification(job: CronJob, runAtMs: number): boolean {
  if (!job.pendingWakeNotificationId) return false;
  const pendingRunAtMs = positiveTimestamp(job.pendingWakeNotificationRunAtMs);
  return pendingRunAtMs !== undefined && Math.abs(pendingRunAtMs - runAtMs) < 1000;
}

function shouldSuppressWakeScheduling(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('permission');
}

async function cancelPendingWakeNotification(job: CronJob): Promise<void> {
  if (job.pendingWakeNotificationId) {
    await cancelLocalNotification(job.pendingWakeNotificationId).catch((error) =>
      console.warn('[scheduler] Failed to cancel wake notification:', error),
    );
  }
  useSchedulerStore.getState().updateJobRuntimeState(job.id, {
    pendingWakeNotificationId: undefined,
    pendingWakeNotificationRunAtMs: undefined,
  });
}

export async function syncSchedulerWakeNotifications(
  options: {
    nowMs?: number;
    force?: boolean;
  } = {},
): Promise<void> {
  const nowMs = options.nowMs ?? Date.now();
  const force = options.force === true;

  for (const jobSnapshot of useSchedulerStore.getState().jobs) {
    const job = useSchedulerStore.getState().getJob(jobSnapshot.id) ?? jobSnapshot;
    const hasPendingWake = Boolean(job.pendingWakeNotificationId);
    if (!force && !hasPendingWake) {
      continue;
    }

    const runAtMs = resolveWakeRunAtMs(job);
    if (
      !job.enabled ||
      job.wakePolicy === 'active_only' ||
      runAtMs === undefined ||
      runAtMs <= nowMs
    ) {
      if (hasPendingWake) {
        await cancelPendingWakeNotification(job);
      }
      continue;
    }

    if (hasMatchingPendingWakeNotification(job, runAtMs)) {
      continue;
    }

    if (hasPendingWake) {
      await cancelPendingWakeNotification(job);
    }

    if (nowMs < suppressWakeSchedulingUntilMs) {
      continue;
    }

    const delaySeconds = Math.max(MIN_WAKE_DELAY_SECONDS, Math.ceil((runAtMs - nowMs) / 1000));
    try {
      const notification = await sendLocalNotification({
        title: job.name || 'Scheduled task',
        body: 'Tap to wake the app and run this scheduled task.',
        delaySeconds,
        data: {
          screen: 'Scheduler',
          jobId: job.id,
          source: 'scheduled_task_wake',
        },
      });
      useSchedulerStore.getState().updateJobRuntimeState(job.id, {
        pendingWakeNotificationId: notification.id,
        pendingWakeNotificationRunAtMs: runAtMs,
        lastWakeAtMs: nowMs,
        lastWakeSource: 'scheduled',
      });
    } catch (error) {
      if (shouldSuppressWakeScheduling(error)) {
        suppressWakeSchedulingUntilMs = nowMs + PERMISSION_DENIAL_SUPPRESSION_MS;
      }
      console.warn('[scheduler] Failed to schedule wake notification:', error);
    }
  }
}
