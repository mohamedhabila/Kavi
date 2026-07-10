import { Platform } from 'react-native';
import {
  scheduleAndroidDurableRecoveryRepair,
  scheduleAndroidDurableRecoveryRunImmediately,
} from './androidDurableRecoveryLifecycle';
import type { DurableRecoveryScheduleOutcome } from './durableRecoverySchedulingTypes';
import {
  initializeIOSDurableRecoveryLifecycle,
  reconcileIOSDurableRecoveryLifecycle,
} from './iosDurableRecoveryLifecycle';
import { schedulePersistedIOSExternalRecoveryRun } from './iosDurableRecoveryScheduling';

export type DurableRecoveryLifecycleSource = 'startup' | 'foreground';

export interface DurableRecoveryLifecycleDependencies {
  platform: string;
  scheduleAndroid(runId: string): Promise<DurableRecoveryScheduleOutcome>;
  scheduleIOS(runId: string): Promise<DurableRecoveryScheduleOutcome>;
  repairAndroid(source: DurableRecoveryLifecycleSource): void;
  initializeIOS(): void;
  reconcileIOS(source: DurableRecoveryLifecycleSource): void;
}

const DEFAULT_DEPENDENCIES: DurableRecoveryLifecycleDependencies = {
  platform: Platform.OS,
  scheduleAndroid: scheduleAndroidDurableRecoveryRunImmediately,
  scheduleIOS: schedulePersistedIOSExternalRecoveryRun,
  repairAndroid: scheduleAndroidDurableRecoveryRepair,
  initializeIOS: initializeIOSDurableRecoveryLifecycle,
  reconcileIOS: reconcileIOSDurableRecoveryLifecycle,
};

/** Schedule the exact persisted journal generation on the active native platform. */
export function scheduleDurableRecoveryRunImmediately(
  runId: string,
  dependencies: DurableRecoveryLifecycleDependencies = DEFAULT_DEPENDENCIES,
): Promise<DurableRecoveryScheduleOutcome> {
  if (dependencies.platform === 'android') return dependencies.scheduleAndroid(runId);
  if (dependencies.platform === 'ios') return dependencies.scheduleIOS(runId);
  return Promise.resolve({ kind: 'not_supported', runId, reason: 'unsupported_platform' });
}

/** Install the platform wake owner and replay persisted recovery work during app startup. */
export function initializeDurableRecoveryLifecycle(
  dependencies: DurableRecoveryLifecycleDependencies = DEFAULT_DEPENDENCIES,
): void {
  if (dependencies.platform === 'android') {
    dependencies.repairAndroid('startup');
  } else if (dependencies.platform === 'ios') {
    dependencies.initializeIOS();
  }
}

/** Repair persisted recovery work after a platform lifecycle transition. */
export function reconcileDurableRecoveryLifecycle(
  source: DurableRecoveryLifecycleSource,
  dependencies: DurableRecoveryLifecycleDependencies = DEFAULT_DEPENDENCIES,
): void {
  if (dependencies.platform === 'android') {
    dependencies.repairAndroid(source);
  } else if (dependencies.platform === 'ios') {
    dependencies.reconcileIOS(source);
  }
}
