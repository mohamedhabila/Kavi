import { type PersistHydratableStore, waitForStoreHydration } from '../../store/persistHydration';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { useSchedulerStore } from './store';
import { useSettingsStore } from '../../store/useSettingsStore';
import { waitForPersistedAgentRecoveryReadiness } from '../startupRecovery';

let readinessPromise: Promise<void> | undefined;

async function initializeSchedulerRuntime(): Promise<void> {
  await Promise.all([
    waitForStoreHydration(
      useSchedulerStore as typeof useSchedulerStore & PersistHydratableStore,
      null,
    ),
    waitForStoreHydration(
      useSettingsStore as typeof useSettingsStore & PersistHydratableStore,
      null,
    ),
    waitForPersistedAgentRecoveryReadiness(),
  ]);
  const reconciled = useSchedulerStore.getState().reconcileStrandedAttempts(Date.now());
  if (reconciled.length > 0) {
    await flushSchedulerStorePersistenceNow();
  }
}

export function ensureSchedulerRuntimeReady(): Promise<void> {
  readinessPromise ??= initializeSchedulerRuntime().catch((error) => {
    readinessPromise = undefined;
    throw error;
  });
  return readinessPromise;
}

export function resetSchedulerRuntimeReadinessForTests(): void {
  readinessPromise = undefined;
}
