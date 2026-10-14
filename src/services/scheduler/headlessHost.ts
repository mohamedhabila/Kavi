// ---------------------------------------------------------------------------
// Kavi — Scheduler Host
// ---------------------------------------------------------------------------
// Scheduled agent work runs while something keeps the JS runtime alive for it: the app in
// the foreground, or a native background job that started a headless task for it (Android
// WorkManager). Without either, the OS may suspend the runtime mid-run, so work waits.

import { AppState } from 'react-native';

let headlessHostCount = 0;

/** Whether a native background job currently holds the runtime open for scheduled work. */
export function isHeadlessSchedulerHostActive(): boolean {
  return headlessHostCount > 0;
}

/** Whether scheduled agent work may start or continue now. */
export function isSchedulerHostActive(): boolean {
  return AppState.currentState === 'active' || isHeadlessSchedulerHostActive();
}

/** Runs `work` while a native background job holds the runtime open. */
export async function withHeadlessSchedulerHost<T>(work: () => Promise<T>): Promise<T> {
  headlessHostCount += 1;
  try {
    return await work();
  } finally {
    headlessHostCount -= 1;
  }
}
