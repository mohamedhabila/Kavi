import type { CronJob, SchedulerTrigger } from '../cron/types';
import { unrefTimerIfSupported } from '../../utils/timers';
import { withSchedulerOperationLock } from './operationLock';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { useSchedulerStore } from './store';
import { drainSchedulerTerminalReports } from './terminalReportProcessor';
import { releaseScheduledProjectionForJob } from './jobExecutorProjection';

const MAX_RECOVERY_DELAY_MS = 60_000;
const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type PersistedMutationResult =
  | { status: 'persisted' }
  | { status: 'not_owned' }
  | { status: 'persistence_failed'; error: unknown };

export function persistAttemptMutation(
  mutate: () => boolean,
  restoreAfterFailure?: (error: unknown) => void,
): Promise<PersistedMutationResult> {
  return withSchedulerOperationLock(async () => {
    if (!mutate()) return { status: 'not_owned' };
    try {
      await flushSchedulerStorePersistenceNow();
      return { status: 'persisted' };
    } catch (error) {
      restoreAfterFailure?.(error);
      return { status: 'persistence_failed', error };
    }
  });
}

export function scheduleAmbiguousSettlementRecovery(params: {
  job: CronJob;
  attemptId: string;
  attempt: number;
  startedAt: number;
  trigger: SchedulerTrigger;
  retryCount?: number;
}): void {
  const key = `${params.job.id}:${params.attemptId}`;
  if (recoveryTimers.has(key)) return;
  const retryCount = params.retryCount ?? 0;
  const delayMs = Math.min(1_000 * 2 ** retryCount, MAX_RECOVERY_DELAY_MS);
  const timer = setTimeout(() => {
    recoveryTimers.delete(key);
    void (async () => {
      const store = useSchedulerStore.getState();
      const completedAt = Date.now();
      const currentJob = store.getJob(params.job.id);
      if (currentJob?.runningAttemptId === params.attemptId) {
        try {
          await releaseScheduledProjectionForJob(currentJob);
        } catch (error) {
          console.warn('[scheduler] Projection release recovery is still pending:', error);
          scheduleAmbiguousSettlementRecovery({ ...params, retryCount: retryCount + 1 });
          return;
        }
      }
      if (currentJob?.lastAmbiguousAttemptId !== params.attemptId) {
        let reconciled: CronJob | undefined;
        const claimSnapshot = currentJob;
        const recovery = await persistAttemptMutation(
          () => {
            if (store.getJob(params.job.id)?.runningAttemptId !== params.attemptId) return false;
            reconciled = store.reconcileStrandedAttempt(
              params.job.id,
              params.attemptId,
              completedAt,
            );
            return reconciled !== undefined;
          },
          () => {
            store.restoreJobAttemptClaim({
              id: params.job.id,
              attemptId: params.attemptId,
              startedAtMs: params.startedAt,
              definitionRevision: params.job.definitionRevision,
              attempt: params.attempt,
              error: reconciled?.lastError,
              claimSnapshot,
            });
          },
        );
        if (recovery.status === 'not_owned' || !reconciled) return;
        if (recovery.status === 'persistence_failed') {
          console.warn(
            '[scheduler] Settlement recovery is still waiting for persistence:',
            recovery.error,
          );
          scheduleAmbiguousSettlementRecovery({ ...params, retryCount: retryCount + 1 });
          return;
        }
      }
      await drainSchedulerTerminalReports().catch((error) =>
        console.warn('[scheduler] Settlement recovery report remains queued:', error),
      );
    })();
  }, delayMs);
  unrefTimerIfSupported(timer);
  recoveryTimers.set(key, timer);
}
