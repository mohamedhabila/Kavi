// ---------------------------------------------------------------------------
// Kavi — Background Task Scheduler for Cron Jobs
// ---------------------------------------------------------------------------
// Uses expo-task-manager + expo-background-task to run scheduled tasks
// when the app is in the background. iOS gives ~30s per wake; Android varies.

const BACKGROUND_TASK_NAME = 'KAVI_CRON_BACKGROUND_FETCH';
const BACKGROUND_EVALUATION_BUDGET_MS = 25_000;

let registered = false;
let taskDefined = false;

type BackgroundTaskModule = typeof import('expo-background-task');

function defineBackgroundTaskIfAvailable(): BackgroundTaskModule | null {
  try {
    const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
    const BackgroundTask = require('expo-background-task') as BackgroundTaskModule;

    if (!taskDefined) {
      TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
        try {
          const { evaluateJobsOnce } = require('./engine') as typeof import('./engine');
          await evaluateJobsOnce({
            trigger: 'background-fetch',
            timeBudgetMs: BACKGROUND_EVALUATION_BUDGET_MS,
          });
          return BackgroundTask.BackgroundTaskResult.Success;
        } catch {
          return BackgroundTask.BackgroundTaskResult.Failed;
        }
      });
      taskDefined = true;
    }

    return BackgroundTask;
  } catch {
    return null;
  }
}

defineBackgroundTaskIfAvailable();

export async function registerBackgroundFetch(): Promise<void> {
  if (registered) return;

  try {
    const BackgroundTask = defineBackgroundTaskIfAvailable();
    if (!BackgroundTask) {
      return;
    }

    // Register with the OS
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: 15,
    });

    registered = true;
  } catch {
    // Background tasks may not be available in Expo Go or some environments.
    // This is non-critical: foreground scheduler still works.
  }
}

export async function unregisterBackgroundFetch(): Promise<void> {
  if (!registered) return;

  try {
    const BackgroundTask = require('expo-background-task') as BackgroundTaskModule;
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK_NAME);
    registered = false;
  } catch {
    // Ignore
  }
}

export function isBackgroundFetchRegistered(): boolean {
  return registered;
}
