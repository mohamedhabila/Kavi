// ---------------------------------------------------------------------------
// Kavi — Headless Scheduled Run
// ---------------------------------------------------------------------------
// The JS side of a background run (Android): KaviScheduledJobsWorker starts the React
// runtime without UI and runs this task. It brings the app's services up the way the app
// does, runs the due scheduled tasks through the normal scheduler, and persists before the
// worker lets the process go. Results land in the conversation and as a notification,
// exactly as for a run started in the app.

import { AppRegistry, Platform } from 'react-native';
import { i18n } from '../../i18n/manager';
import { flushPendingStorageWrites } from '../../store/throttledStorage';
import { initializeServices } from '../startup';
import { evaluateJobsOnce } from './engine';
import { withHeadlessSchedulerHost } from './headlessHost';

export const SCHEDULED_JOBS_HEADLESS_TASK = 'KaviScheduledJobRun';

/**
 * How long after the task starts it may still start another due task. The native task
 * timeout is 8 minutes and WorkManager stops a job at 10, so a task started late would be
 * cut off mid-run.
 */
export const HEADLESS_NEW_TASK_BUDGET_MS = 5 * 60_000;

export async function runDueScheduledJobsHeadless(): Promise<void> {
  await i18n.init();
  initializeServices();
  try {
    await withHeadlessSchedulerHost(() =>
      evaluateJobsOnce({ trigger: 'background-wake', timeBudgetMs: HEADLESS_NEW_TASK_BUDGET_MS }),
    );
  } finally {
    await flushPendingStorageWrites();
  }
}

export function registerScheduledJobsHeadlessTask(): void {
  if (Platform.OS !== 'android') return;
  AppRegistry.registerHeadlessTask(SCHEDULED_JOBS_HEADLESS_TASK, () => runDueScheduledJobsHeadless);
}
