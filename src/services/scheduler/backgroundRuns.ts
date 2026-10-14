// ---------------------------------------------------------------------------
// Kavi — Background Scheduled Runs
// ---------------------------------------------------------------------------
// On Android a WorkManager job wakes the app at the next due time and runs the due
// scheduled tasks headlessly (KaviScheduledJobsWorker → the KaviScheduledJobRun task).
// Elsewhere the native module is absent and the wake notification is the only path.

import { NativeModules, Platform } from 'react-native';

type ScheduledJobsNativeModule = {
  scheduleRun(atMs: number): Promise<void>;
  cancelRun(): Promise<void>;
};

/**
 * How long after a task's due time its tap-to-run notification fires when a background run
 * is scheduled for it. The notification is the fallback for a run the OS deferred (Doze,
 * battery restrictions); a run that happened replaces it with the next occurrence's.
 */
export const BACKGROUND_RUN_WAKE_NOTIFICATION_GRACE_MS = 10 * 60_000;

/**
 * The earliest a past-due run is scheduled again. A task still due after a background run
 * (it could not start) would otherwise wake the app again at once, in a loop.
 */
export const PAST_DUE_BACKGROUND_RUN_SPACING_MS = 5 * 60_000;

function scheduledJobsNativeModule(): ScheduledJobsNativeModule | undefined {
  if (Platform.OS !== 'android') return undefined;
  return NativeModules.KaviScheduledJobs as ScheduledJobsNativeModule | undefined;
}

/** Whether due scheduled tasks run in the background on this device. */
export function supportsBackgroundScheduledRuns(): boolean {
  return scheduledJobsNativeModule() !== undefined;
}

/** When the next background run should wake the app for a task due at `dueAtMs`. */
export function resolveBackgroundRunAtMs(dueAtMs: number, nowMs: number): number {
  return dueAtMs > nowMs ? dueAtMs : nowMs + PAST_DUE_BACKGROUND_RUN_SPACING_MS;
}

/**
 * Schedules the one background run that wakes the app for the earliest due task, replacing
 * any earlier schedule, or clears it when nothing is due.
 */
export async function scheduleNextBackgroundScheduledRun(
  dueAtMs: number | undefined,
  nowMs: number,
): Promise<void> {
  const nativeModule = scheduledJobsNativeModule();
  if (!nativeModule) return;
  if (dueAtMs === undefined) {
    await nativeModule.cancelRun();
    return;
  }
  await nativeModule.scheduleRun(resolveBackgroundRunAtMs(dueAtMs, nowMs));
}
