import { Platform } from 'react-native';
import type { AndroidDurableRecoveryScheduleOutcome } from './androidDurableRecoveryScheduling';

type AndroidDurableRecoveryRepairSource = 'startup' | 'foreground';

interface AndroidDurableRecoveryLifecycleDependencies {
  platform: string;
  scheduleCandidates(): Promise<readonly { kind: string }[]>;
}

interface AndroidImmediateRecoveryDependencies {
  platform: string;
  scheduleRun(runId: string): Promise<AndroidDurableRecoveryScheduleOutcome>;
}

const DEFAULT_DEPENDENCIES: AndroidDurableRecoveryLifecycleDependencies = {
  platform: Platform.OS,
  scheduleCandidates: () => {
    const { schedulePersistedAndroidExternalRecoveryCandidates } =
      require('./androidDurableRecoveryScheduling') as typeof import('./androidDurableRecoveryScheduling');
    return schedulePersistedAndroidExternalRecoveryCandidates();
  },
};

const DEFAULT_IMMEDIATE_DEPENDENCIES: AndroidImmediateRecoveryDependencies = {
  platform: Platform.OS,
  scheduleRun: (runId) => {
    const { schedulePersistedAndroidExternalRecoveryRun } =
      require('./androidDurableRecoveryScheduling') as typeof import('./androidDurableRecoveryScheduling');
    return schedulePersistedAndroidExternalRecoveryRun(runId);
  },
};

export type AndroidImmediateRecoveryOutcome =
  | AndroidDurableRecoveryScheduleOutcome
  | { kind: 'not_android'; runId: string };

/** Schedule a just-persisted generation before the foreground process can disappear. */
export function scheduleAndroidDurableRecoveryRunImmediately(
  runId: string,
  dependencies: AndroidImmediateRecoveryDependencies = DEFAULT_IMMEDIATE_DEPENDENCIES,
): Promise<AndroidImmediateRecoveryOutcome> {
  return dependencies.platform === 'android'
    ? dependencies.scheduleRun(runId)
    : Promise.resolve({ kind: 'not_android', runId });
}

export function scheduleAndroidDurableRecoveryRepair(
  source: AndroidDurableRecoveryRepairSource,
  dependencies: AndroidDurableRecoveryLifecycleDependencies = DEFAULT_DEPENDENCIES,
): void {
  if (dependencies.platform !== 'android') return;
  void dependencies
    .scheduleCandidates()
    .then((outcomes) => {
      if (outcomes.some((outcome) => outcome.kind === 'deferred' || outcome.kind === 'blocked')) {
        console.warn(`[startup] Android durable recovery ${source} scan needs attention`);
      }
    })
    .catch((error) => {
      console.warn(`[startup] Android durable recovery ${source} scan failed:`, error);
    });
}
