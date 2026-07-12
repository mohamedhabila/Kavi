// ---------------------------------------------------------------------------
// Kavi — Scheduler Wake Notifications
// ---------------------------------------------------------------------------
// Schedules local notifications that let users wake the app for due tasks
// when the OS does not grant a background execution window.

import * as Crypto from 'expo-crypto';
import {
  cancelLocalNotification,
  listScheduledLocalNotifications,
  sendLocalNotification,
} from '../notifications/service';
import type { CronJob } from '../cron/types';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { useSchedulerStore } from './store';

const MIN_WAKE_DELAY_SECONDS = 1;
const PERMISSION_DENIAL_SUPPRESSION_MS = 60 * 60 * 1000;

let suppressWakeSchedulingUntilMs = 0;
let wakeOperationTail: Promise<void> = Promise.resolve();

export interface SchedulerWakeSyncResult {
  warnings: string[];
}

function enqueueWakeOperation<T>(operation: () => Promise<T>): Promise<T> {
  const running = wakeOperationTail.then(operation, operation);
  wakeOperationTail = running.then(
    () => undefined,
    () => undefined,
  );
  return running;
}

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

function resolveWakeTitle(job: CronJob): string {
  return job.name?.trim() || 'Scheduled task';
}

function hasMatchingPendingWakeNotification(
  job: CronJob,
  runAtMs: number,
  expectedId: string,
  scheduledIds: ReadonlySet<string> | undefined,
): boolean {
  if (!job.pendingWakeNotificationId) return false;
  const pendingRunAtMs = positiveTimestamp(job.pendingWakeNotificationRunAtMs);
  return (
    job.pendingWakeNotificationId === expectedId &&
    (scheduledIds === undefined || scheduledIds.has(expectedId)) &&
    pendingRunAtMs !== undefined &&
    Math.abs(pendingRunAtMs - runAtMs) < 1000 &&
    job.pendingWakeNotificationTitle === resolveWakeTitle(job)
  );
}

async function buildSchedulerWakeNotificationId(
  job: CronJob,
  runAtMs: number,
  title: string,
): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(['kavi.scheduler-wake.v1', job.id, job.definitionRevision, runAtMs, title]),
  );
  return `scheduler-wake-${digest.toLowerCase().slice(0, 32)}`;
}

function shouldSuppressWakeScheduling(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('permission');
}

async function recordWakeWarning(jobId: string, warning: string, timestamp: number): Promise<void> {
  useSchedulerStore.getState().updateJobRuntimeState(jobId, {
    lastWakeError: warning,
    lastWakeFailureAtMs: timestamp,
  });
  await flushSchedulerStorePersistenceNow().catch((error) =>
    console.warn('[scheduler] Failed to persist wake warning:', error),
  );
}

async function cancelPendingWakeNotification(job: CronJob): Promise<void> {
  const notificationId = job.pendingWakeNotificationId;
  if (!notificationId) return;
  await cancelLocalNotification(notificationId);
  const currentJob = useSchedulerStore.getState().getJob(job.id);
  if (currentJob?.pendingWakeNotificationId !== notificationId) return;
  useSchedulerStore.getState().updateJobRuntimeState(job.id, {
    pendingWakeNotificationId: undefined,
    pendingWakeNotificationRunAtMs: undefined,
    pendingWakeNotificationTitle: undefined,
    lastWakeError: undefined,
    lastWakeFailureAtMs: undefined,
  });
  await flushSchedulerStorePersistenceNow();
}

async function syncWakeNotifications(
  options: {
    nowMs?: number;
    force?: boolean;
    preserveDueWake?: boolean;
  } = {},
): Promise<SchedulerWakeSyncResult> {
  const nowMs = options.nowMs ?? Date.now();
  const force = options.force === true;
  const preserveDueWake = options.preserveDueWake === true;
  const warnings: string[] = [];

  let scheduledWakes: Awaited<ReturnType<typeof listScheduledLocalNotifications>> | undefined;
  try {
    scheduledWakes = await listScheduledLocalNotifications();
  } catch (error) {
    const warning = `Failed to inspect scheduled wake notifications: ${
      error instanceof Error ? error.message : String(error)
    }`;
    warnings.push(warning);
    console.warn('[scheduler] Failed to inspect scheduled wake notifications:', error);
  }
  const scheduledIds = scheduledWakes
    ? new Set(scheduledWakes.map((notification) => notification.id))
    : undefined;
  const expectedWakeIds = new Map<string, string>();
  for (const job of useSchedulerStore.getState().jobs) {
    const runAtMs = resolveWakeRunAtMs(job);
    const due = runAtMs !== undefined && runAtMs <= nowMs;
    if (
      job.enabled &&
      job.wakePolicy !== 'active_only' &&
      runAtMs !== undefined &&
      (!due || preserveDueWake)
    ) {
      expectedWakeIds.set(
        job.id,
        await buildSchedulerWakeNotificationId(job, runAtMs, resolveWakeTitle(job)),
      );
    }
  }
  if (scheduledWakes) {
    for (const scheduled of scheduledWakes) {
      if (
        scheduled.data.source !== 'scheduled_task_wake' ||
        (scheduled.data.jobId && expectedWakeIds.get(scheduled.data.jobId) === scheduled.id)
      ) {
        continue;
      }
      try {
        await cancelLocalNotification(scheduled.id);
        scheduledIds?.delete(scheduled.id);
      } catch (error) {
        const warning = `Failed to remove orphaned wake notification: ${
          error instanceof Error ? error.message : String(error)
        }`;
        warnings.push(warning);
      }
    }
  }

  for (const jobSnapshot of useSchedulerStore.getState().jobs) {
    let job = useSchedulerStore.getState().getJob(jobSnapshot.id) ?? jobSnapshot;
    let hasPendingWake = Boolean(job.pendingWakeNotificationId);

    const runAtMs = resolveWakeRunAtMs(job);
    const due = runAtMs !== undefined && runAtMs <= nowMs;
    const wakeTitle = resolveWakeTitle(job);
    const expectedWakeId = runAtMs === undefined ? undefined : expectedWakeIds.get(job.id);
    if (!hasPendingWake && expectedWakeId && scheduledIds?.has(expectedWakeId)) {
      useSchedulerStore.getState().updateJobRuntimeState(job.id, {
        pendingWakeNotificationId: expectedWakeId,
        pendingWakeNotificationRunAtMs: runAtMs,
        pendingWakeNotificationTitle: wakeTitle,
        lastWakeError: undefined,
        lastWakeFailureAtMs: undefined,
      });
      await flushSchedulerStorePersistenceNow();
      job = useSchedulerStore.getState().getJob(job.id) ?? job;
      hasPendingWake = true;
    }
    if (!force && !hasPendingWake) {
      continue;
    }
    if (
      !job.enabled ||
      job.wakePolicy === 'active_only' ||
      runAtMs === undefined ||
      (due && !preserveDueWake)
    ) {
      if (hasPendingWake) {
        try {
          await cancelPendingWakeNotification(job);
        } catch (error) {
          const warning = `Failed to cancel wake notification for "${job.name}": ${
            error instanceof Error ? error.message : String(error)
          }`;
          warnings.push(warning);
          await recordWakeWarning(job.id, warning, nowMs);
        }
      }
      continue;
    }

    if (due && hasPendingWake) {
      try {
        await cancelPendingWakeNotification(job);
        job = useSchedulerStore.getState().getJob(job.id) ?? job;
        hasPendingWake = Boolean(job.pendingWakeNotificationId);
      } catch (error) {
        const warning = `Failed to replace a consumed wake notification for "${job.name}": ${
          error instanceof Error ? error.message : String(error)
        }`;
        warnings.push(warning);
        await recordWakeWarning(job.id, warning, nowMs);
        continue;
      }
    }

    if (
      !due &&
      expectedWakeId &&
      hasMatchingPendingWakeNotification(job, runAtMs, expectedWakeId, scheduledIds)
    ) {
      continue;
    }

    if (hasPendingWake) {
      try {
        await cancelPendingWakeNotification(job);
      } catch (error) {
        const warning = `Failed to replace wake notification for "${job.name}": ${
          error instanceof Error ? error.message : String(error)
        }`;
        warnings.push(warning);
        await recordWakeWarning(job.id, warning, nowMs);
        continue;
      }
    }

    if (nowMs < suppressWakeSchedulingUntilMs) {
      const warning = `Wake notification scheduling for "${job.name}" is temporarily suppressed after a permission failure.`;
      warnings.push(warning);
      await recordWakeWarning(job.id, warning, nowMs);
      continue;
    }

    const delaySeconds = Math.max(MIN_WAKE_DELAY_SECONDS, Math.ceil((runAtMs - nowMs) / 1000));
    try {
      const requestedNotificationId =
        expectedWakeId ?? (await buildSchedulerWakeNotificationId(job, runAtMs, wakeTitle));
      const notification = await sendLocalNotification({
        identifier: requestedNotificationId,
        title: wakeTitle,
        body: 'Tap to wake the app and run this scheduled task.',
        delaySeconds,
        data: {
          screen: 'Scheduler',
          jobId: job.id,
          source: 'scheduled_task_wake',
        },
      });
      if (notification.id !== requestedNotificationId) {
        await cancelLocalNotification(notification.id).catch(() => undefined);
        throw new Error('the notification service returned a different wake identifier');
      }
      scheduledIds?.add(notification.id);
      const currentJob = useSchedulerStore.getState().getJob(job.id);
      if (
        !currentJob?.enabled ||
        currentJob.wakePolicy === 'active_only' ||
        resolveWakeRunAtMs(currentJob) !== runAtMs ||
        resolveWakeTitle(currentJob) !== wakeTitle
      ) {
        try {
          await cancelLocalNotification(notification.id);
        } catch (cancelError) {
          const latestJob = useSchedulerStore.getState().getJob(job.id);
          if (latestJob) {
            useSchedulerStore.getState().updateJobRuntimeState(job.id, {
              pendingWakeNotificationId: notification.id,
              pendingWakeNotificationRunAtMs: runAtMs,
              pendingWakeNotificationTitle: wakeTitle,
            });
            await flushSchedulerStorePersistenceNow().catch(() => undefined);
          }
          throw new Error(
            `the job changed after scheduling and the new wake could not be cancelled: ${
              cancelError instanceof Error ? cancelError.message : String(cancelError)
            }`,
          );
        }
        continue;
      }
      useSchedulerStore.getState().updateJobRuntimeState(job.id, {
        pendingWakeNotificationId: notification.id,
        pendingWakeNotificationRunAtMs: runAtMs,
        pendingWakeNotificationTitle: wakeTitle,
        lastWakeAtMs: nowMs,
        lastWakeSource: 'scheduled',
        lastWakeError: undefined,
        lastWakeFailureAtMs: undefined,
      });
      try {
        await flushSchedulerStorePersistenceNow();
      } catch (persistenceError) {
        const latestJob = useSchedulerStore.getState().getJob(job.id);
        if (latestJob?.pendingWakeNotificationId === notification.id) {
          useSchedulerStore.getState().updateJobRuntimeState(job.id, {
            pendingWakeNotificationId: undefined,
            pendingWakeNotificationRunAtMs: undefined,
            pendingWakeNotificationTitle: undefined,
          });
        }
        try {
          await cancelLocalNotification(notification.id);
        } catch (cancelError) {
          const latestJobAfterFailure = useSchedulerStore.getState().getJob(job.id);
          if (latestJobAfterFailure) {
            useSchedulerStore.getState().updateJobRuntimeState(job.id, {
              pendingWakeNotificationId: notification.id,
              pendingWakeNotificationRunAtMs: runAtMs,
              pendingWakeNotificationTitle: wakeTitle,
            });
            await flushSchedulerStorePersistenceNow().catch(() => undefined);
          }
          throw new Error(
            `wake state persistence failed and the notification could not be cancelled: ${
              cancelError instanceof Error ? cancelError.message : String(cancelError)
            }`,
          );
        }
        throw persistenceError;
      }
    } catch (error) {
      if (shouldSuppressWakeScheduling(error)) {
        suppressWakeSchedulingUntilMs = nowMs + PERMISSION_DENIAL_SUPPRESSION_MS;
      }
      const warning = `Failed to schedule wake notification for "${job.name}": ${
        error instanceof Error ? error.message : String(error)
      }`;
      warnings.push(warning);
      await recordWakeWarning(job.id, warning, nowMs);
      console.warn('[scheduler] Failed to schedule wake notification:', error);
    }
  }
  return { warnings };
}

export function syncSchedulerWakeNotifications(
  options: {
    nowMs?: number;
    force?: boolean;
    preserveDueWake?: boolean;
  } = {},
): Promise<SchedulerWakeSyncResult> {
  return enqueueWakeOperation(() => syncWakeNotifications(options));
}

export function cancelSchedulerJobWake(job: CronJob): Promise<void> {
  return enqueueWakeOperation(() =>
    cancelPendingWakeNotification(useSchedulerStore.getState().getJob(job.id) ?? job),
  );
}

export function consumeSchedulerJobWake(jobId: string, notificationId: string): Promise<boolean> {
  return enqueueWakeOperation(async () => {
    const job = useSchedulerStore.getState().getJob(jobId);
    if (!job || job.pendingWakeNotificationId !== notificationId) return false;
    const previousWake = {
      pendingWakeNotificationId: job.pendingWakeNotificationId,
      pendingWakeNotificationRunAtMs: job.pendingWakeNotificationRunAtMs,
      pendingWakeNotificationTitle: job.pendingWakeNotificationTitle,
    };
    useSchedulerStore.getState().updateJobRuntimeState(jobId, {
      pendingWakeNotificationId: undefined,
      pendingWakeNotificationRunAtMs: undefined,
      pendingWakeNotificationTitle: undefined,
    });
    try {
      await flushSchedulerStorePersistenceNow();
      await cancelLocalNotification(notificationId).catch((error) =>
        console.warn('[scheduler] Consumed wake cancellation will be reconciled later:', error),
      );
      return true;
    } catch (error) {
      const currentJob = useSchedulerStore.getState().getJob(jobId);
      if (currentJob && !currentJob.pendingWakeNotificationId) {
        useSchedulerStore.getState().updateJobRuntimeState(jobId, previousWake);
      }
      throw error;
    }
  });
}

export function resetSchedulerWakeOperationsForTests(): void {
  wakeOperationTail = Promise.resolve();
  suppressWakeSchedulingUntilMs = 0;
}
