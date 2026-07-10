import { Platform } from 'react-native';
import type {
  AndroidDurableRecoveryScheduleOutcome,
  SchedulePersistedAndroidExternalRecoveryCandidateSliceInput,
  SchedulePersistedAndroidExternalRecoveryCandidateSliceResult,
} from './androidDurableRecoveryScheduling';

type AndroidDurableRecoveryRepairSource = 'startup' | 'foreground';
const REPAIR_SLICE_SIZE = 25;

interface AndroidDurableRecoveryLifecycleDependencies {
  platform: string;
  scheduleSlice(
    input: SchedulePersistedAndroidExternalRecoveryCandidateSliceInput,
  ): Promise<SchedulePersistedAndroidExternalRecoveryCandidateSliceResult>;
  continueAfterYield(continuation: () => void): void;
}

interface AndroidImmediateRecoveryDependencies {
  platform: string;
  scheduleRun(runId: string): Promise<AndroidDurableRecoveryScheduleOutcome>;
}

const DEFAULT_DEPENDENCIES: AndroidDurableRecoveryLifecycleDependencies = {
  platform: Platform.OS,
  scheduleSlice: (input) => {
    const { schedulePersistedAndroidExternalRecoveryCandidateSlice } =
      require('./androidDurableRecoveryScheduling') as typeof import('./androidDurableRecoveryScheduling');
    return schedulePersistedAndroidExternalRecoveryCandidateSlice(input);
  },
  continueAfterYield: (continuation) => {
    setTimeout(continuation, 0);
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
  scheduleRepairSlice(source, undefined, dependencies);
}

function scheduleRepairSlice(
  source: AndroidDurableRecoveryRepairSource,
  after: string | undefined,
  dependencies: AndroidDurableRecoveryLifecycleDependencies,
): void {
  void dependencies
    .scheduleSlice({
      limit: REPAIR_SLICE_SIZE,
      ...(after === undefined ? {} : { after }),
    })
    .then((slice) => {
      if (
        slice.outcomes.some((outcome) => outcome.kind === 'deferred' || outcome.kind === 'blocked')
      ) {
        console.warn(`[startup] Android durable recovery ${source} scan needs attention`);
      }
      if (slice.nextAfter === null) return;
      if (slice.nextAfter === after) {
        throw new Error('android-durable-scan-cursor-stalled');
      }
      dependencies.continueAfterYield(() => {
        scheduleRepairSlice(source, slice.nextAfter!, dependencies);
      });
    })
    .catch((error) => {
      console.warn(`[startup] Android durable recovery ${source} scan failed:`, error);
    });
}
