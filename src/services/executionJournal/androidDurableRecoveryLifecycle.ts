import { Platform } from 'react-native';

type AndroidDurableRecoveryRepairSource = 'startup' | 'foreground';

interface AndroidDurableRecoveryLifecycleDependencies {
  platform: string;
  scheduleCandidates(): Promise<readonly { kind: string }[]>;
}

const DEFAULT_DEPENDENCIES: AndroidDurableRecoveryLifecycleDependencies = {
  platform: Platform.OS,
  scheduleCandidates: () => {
    const { schedulePersistedAndroidExternalRecoveryCandidates } = require(
      './androidDurableRecoveryScheduling'
    ) as typeof import('./androidDurableRecoveryScheduling');
    return schedulePersistedAndroidExternalRecoveryCandidates();
  },
};

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
