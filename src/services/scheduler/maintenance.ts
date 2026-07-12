import { ensureSchedulerMaintenanceReady } from './runtimeReadiness';
import { syncSchedulerWakeNotifications } from './wakeNotifications';

/**
 * Reconcile durable scheduler state and wake notifications without claiming or
 * dispatching agent work. Expo background windows cannot safely own arbitrary
 * tool execution, so due jobs remain eligible for a foreground runtime.
 */
export async function maintainSchedulerRuntimeOnce(nowMs?: number): Promise<void> {
  await ensureSchedulerMaintenanceReady();
  const wakeResult = await syncSchedulerWakeNotifications({
    nowMs: nowMs ?? Date.now(),
    force: true,
    preserveDueWake: true,
  });
  if (wakeResult.warnings.length > 0) {
    throw new Error(wakeResult.warnings.join(' '));
  }
}
