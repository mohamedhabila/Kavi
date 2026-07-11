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
  repairAndroid(source: DurableRecoveryLifecycleSource): Promise<void>;
  initializeIOS(): void;
  reconcileIOS(source: DurableRecoveryLifecycleSource): Promise<void>;
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

/** Install the platform wake owner without racing hydrated chat recovery. */
export function initializeDurableRecoveryLifecycle(
  dependencies: DurableRecoveryLifecycleDependencies = DEFAULT_DEPENDENCIES,
): void {
  if (dependencies.platform === 'ios') {
    dependencies.initializeIOS();
  }
}

/** Await scheduling and pending-wake reconciliation for the current lifecycle sweep. */
export function reconcileDurableRecoveryLifecycle(
  source: DurableRecoveryLifecycleSource,
  dependencies: DurableRecoveryLifecycleDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (dependencies.platform === 'android') {
    return dependencies.repairAndroid(source);
  }
  if (dependencies.platform === 'ios') return dependencies.reconcileIOS(source);
  return Promise.resolve();
}
