import { Platform } from 'react-native';
import type {
  SchedulePersistedAndroidExternalRecoveryCandidateSliceInput,
  SchedulePersistedAndroidExternalRecoveryCandidateSliceResult,
} from './androidDurableRecoveryScheduling';
import type { DurableRecoveryScheduleOutcome } from './durableRecoverySchedulingTypes';

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
  scheduleRun(runId: string): Promise<DurableRecoveryScheduleOutcome>;
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

/** Schedule a just-persisted generation before the foreground process can disappear. */
export function scheduleAndroidDurableRecoveryRunImmediately(
  runId: string,
  dependencies: AndroidImmediateRecoveryDependencies = DEFAULT_IMMEDIATE_DEPENDENCIES,
): Promise<DurableRecoveryScheduleOutcome> {
  return dependencies.platform === 'android'
    ? dependencies.scheduleRun(runId)
    : Promise.resolve({ kind: 'not_supported', runId, reason: 'unsupported_platform' });
}

export function scheduleAndroidDurableRecoveryRepair(
  source: AndroidDurableRecoveryRepairSource,
  dependencies: AndroidDurableRecoveryLifecycleDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (dependencies.platform !== 'android') return Promise.resolve();
  return scheduleRepairSlices(source, dependencies).catch((error) => {
    console.warn(`[startup] Android durable recovery ${source} scan failed:`, error);
  });
}

async function scheduleRepairSlices(
  source: AndroidDurableRecoveryRepairSource,
  dependencies: AndroidDurableRecoveryLifecycleDependencies,
): Promise<void> {
  let after: string | undefined;
  while (true) {
    const slice = await dependencies.scheduleSlice({
      limit: REPAIR_SLICE_SIZE,
      ...(after === undefined ? {} : { after }),
    });
    if (
      slice.outcomes.some((outcome) => outcome.kind === 'deferred' || outcome.kind === 'blocked')
    ) {
      console.warn(`[startup] Android durable recovery ${source} scan needs attention`);
    }
    if (slice.nextAfter === null) return;
    if (slice.nextAfter === after) {
      throw new Error('android-durable-scan-cursor-stalled');
    }
    after = slice.nextAfter;
    await new Promise<void>((resolve) => dependencies.continueAfterYield(resolve));
  }
}
