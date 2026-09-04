import { ensureSchedulerMaintenanceReady } from './runtimeReadiness';
import { syncSchedulerWakeNotifications } from './wakeNotifications';
import { reconcilePendingReminders } from './reminders/rearm';

/**
 * Reconcile durable scheduler state and wake notifications without claiming or
 * dispatching agent work. Expo background windows cannot safely own arbitrary
 * tool execution, so due jobs remain eligible for a foreground runtime.
 *
 * Also re-arms elapsed once/monthly reminder notifications (see
 * reminders/rearm.ts) — reminders are delivered directly by the OS, but a
 * monthly recurrence needs its next occurrence's native trigger scheduled
 * from here since expo-notifications has no re-arming monthly trigger. This
 * is best-effort and never fails the background task: a missed re-arm just
 * gets retried on the next ~15 minute cycle or the next foreground
 * activation, which does not warrant marking scheduled-job wake maintenance
 * (the throw below) as failed.
 */
export async function maintainSchedulerRuntimeOnce(nowMs?: number): Promise<void> {
  await ensureSchedulerMaintenanceReady();
  const resolvedNowMs = nowMs ?? Date.now();
  const [wakeResult] = await Promise.all([
    syncSchedulerWakeNotifications({
      nowMs: resolvedNowMs,
      force: true,
      preserveDueWake: true,
    }),
    reconcilePendingReminders(resolvedNowMs).catch((error) => {
      console.warn('[scheduler] Reminder reconciliation failed:', error);
      return { warnings: [] };
    }),
  ]);
  if (wakeResult.warnings.length > 0) {
    throw new Error(wakeResult.warnings.join(' '));
  }
}
