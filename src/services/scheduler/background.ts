// ---------------------------------------------------------------------------
// Kavi — Background Fetch for Cron Jobs
// ---------------------------------------------------------------------------
// Uses expo-task-manager + expo-background-fetch to run scheduled tasks
// when the app is in the background. iOS gives ~30s per wake; Android varies.

const BACKGROUND_TASK_NAME = 'KAVI_CRON_BACKGROUND_FETCH';

let registered = false;

export async function registerBackgroundFetch(): Promise<void> {
  if (registered) return;

  try {
    const TaskManager = await import('expo-task-manager');
    const BackgroundFetch = await import('expo-background-fetch');

    // Define the background task
    TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
      try {
        // Import scheduler engine lazily to avoid circular deps
        const { evaluateJobsOnce } = await import('./engine');
        await evaluateJobsOnce();
        return BackgroundFetch.BackgroundFetchResult.NewData;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });

    // Register with the OS
    await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: 15 * 60, // iOS minimum is 15 minutes
      stopOnTerminate: false,
      startOnBoot: true,
    });

    registered = true;
  } catch {
    // Background fetch may not be available in Expo Go or some environments
    // This is non-critical — foreground scheduler still works
  }
}

export async function unregisterBackgroundFetch(): Promise<void> {
  if (!registered) return;

  try {
    const BackgroundFetch = await import('expo-background-fetch');
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_TASK_NAME);
    registered = false;
  } catch {
    // Ignore
  }
}

export function isBackgroundFetchRegistered(): boolean {
  return registered;
}
