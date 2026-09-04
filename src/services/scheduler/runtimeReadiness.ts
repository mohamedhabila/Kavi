import {
  type PersistHydratableStore,
  waitForRequiredStoreHydration,
} from '../../store/persistHydration';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { useSchedulerStore } from './store';
import { useSettingsStore } from '../../store/useSettingsStore';
import { waitForPersistedAgentRecoveryReadiness } from '../startupRecovery';
import { useExecutionTraceStore } from './traceStore';
import { drainSchedulerTerminalReports } from './terminalReportProcessor';
import { reconcilePendingReminders } from './reminders/rearm';

let readinessPromise: Promise<void> | undefined;
let schedulerStateReadinessPromise: Promise<void> | undefined;
let reconciliationPersistencePending = false;
let executionReadinessBarrier: (() => Promise<void>) | undefined;
const REQUIRED_HYDRATION_TIMEOUT_MS = 5_000;

async function initializeSchedulerState(): Promise<void> {
  // Projection recovery consumes runningEffectRisk/runningCompletion. Reconcile
  // only after it has settled and released stale scheduler-owned transcripts.
  await waitForPersistedAgentRecoveryReadiness();
  await Promise.all([
    waitForRequiredStoreHydration(
      useSchedulerStore as typeof useSchedulerStore & PersistHydratableStore,
      { name: 'scheduler state', timeoutMs: REQUIRED_HYDRATION_TIMEOUT_MS },
    ),
    waitForRequiredStoreHydration(
      useExecutionTraceStore as typeof useExecutionTraceStore & PersistHydratableStore,
      { name: 'scheduler trace state', timeoutMs: REQUIRED_HYDRATION_TIMEOUT_MS },
    ),
  ]);
  const timestamp = Date.now();
  const reconciled = useSchedulerStore.getState().reconcileStrandedAttempts(timestamp);
  if (reconciled.length > 0) reconciliationPersistencePending = true;
  if (reconciliationPersistencePending) {
    if (reconciled.length === 0) useSchedulerStore.getState().requestPersistence();
    await flushSchedulerStorePersistenceNow();
    reconciliationPersistencePending = false;
  }
  await drainSchedulerTerminalReports().catch((error) =>
    console.warn('[scheduler] Terminal report recovery remains queued:', error),
  );
}

async function initializeSchedulerRuntime(): Promise<void> {
  await Promise.all([
    executionReadinessBarrier?.(),
    ensureSchedulerMaintenanceReady(),
    waitForRequiredStoreHydration(
      useSettingsStore as typeof useSettingsStore & PersistHydratableStore,
      { name: 'settings state', timeoutMs: REQUIRED_HYDRATION_TIMEOUT_MS },
    ),
  ]);
  // Best-effort and non-blocking: re-arm any elapsed once/monthly reminder
  // notifications on every foreground activation, mirroring the background
  // task's reminders/rearm.ts call in maintenance.ts. Never gate scheduler
  // runtime readiness on this.
  void reconcilePendingReminders().catch((error) => {
    console.warn('[scheduler] Reminder reconciliation failed:', error);
  });
}

export function setSchedulerExecutionReadinessBarrier(
  barrier: (() => Promise<void>) | undefined,
): void {
  executionReadinessBarrier = barrier;
  readinessPromise = undefined;
}

export function ensureSchedulerMaintenanceReady(): Promise<void> {
  schedulerStateReadinessPromise ??= initializeSchedulerState().catch((error) => {
    schedulerStateReadinessPromise = undefined;
    throw error;
  });
  return schedulerStateReadinessPromise;
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
  schedulerStateReadinessPromise = undefined;
  reconciliationPersistencePending = false;
  executionReadinessBarrier = undefined;
}
