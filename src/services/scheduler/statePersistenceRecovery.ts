import { unrefTimerIfSupported } from '../../utils/timers';
import { withSchedulerOperationLock } from './operationLock';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { useSchedulerStore } from './store';

const MAX_RECOVERY_DELAY_MS = 60_000;

let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Keep retrying the latest scheduler snapshot after a write failure. Callers
 * must still report their operation as failed; this recovery only preserves
 * the fail-closed in-memory state across a later restart.
 */
export function scheduleSchedulerStatePersistenceRecovery(context: string, retryCount = 0): void {
  if (recoveryTimer) return;
  const delayMs = Math.min(1_000 * 2 ** retryCount, MAX_RECOVERY_DELAY_MS);
  recoveryTimer = setTimeout(() => {
    recoveryTimer = undefined;
    void withSchedulerOperationLock(async () => {
      useSchedulerStore.getState().requestPersistence();
      try {
        await flushSchedulerStorePersistenceNow();
      } catch (error) {
        console.warn(`[scheduler] ${context} is still waiting for persistence:`, error);
        scheduleSchedulerStatePersistenceRecovery(context, retryCount + 1);
      }
    });
  }, delayMs);
  unrefTimerIfSupported(recoveryTimer);
}

export function resetSchedulerStatePersistenceRecoveryForTests(): void {
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = undefined;
}
