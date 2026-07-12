import type { CronJob, SchedulerTrigger } from '../cron/types';
import { emitActiveSchedulerEvent } from './activeSchedulerEvent';
import type {
  SchedulerAppBackgroundAbortError,
  SchedulerExecutionError,
  SchedulerProjectionBusyError,
} from './executionError';
import { persistAttemptMutation, scheduleAmbiguousSettlementRecovery } from './attemptRecovery';
import type { useSchedulerStore } from './store';
import { buildSchedulerTerminalReport } from './terminalReport';
import { drainSchedulerTerminalReports } from './terminalReportProcessor';

type SchedulerStoreState = ReturnType<typeof useSchedulerStore.getState>;

type SafeDeferralParams = {
  store: SchedulerStoreState;
  job: CronJob;
  attemptId: string;
  attempt: number;
  startedAtMs: number;
  claimedAtMs: number;
  completedAtMs: number;
  trigger: SchedulerTrigger;
  error: string;
  executionError: SchedulerExecutionError;
  maxRetries: number;
};

async function settleSafeDeferral(
  params: SafeDeferralParams,
): Promise<
  { status: 'retrying' | 'failed'; error: string } | { status: 'skipped'; reason: 'ineligible' }
> {
  const report = buildSchedulerTerminalReport({
    attemptId: params.attemptId,
    job: params.job,
    status: 'retrying',
    notification: 'none',
    startedAtMs: params.startedAtMs,
    completedAtMs: params.completedAtMs,
    attempt: params.attempt,
    trigger: params.trigger,
    error: params.error,
    warnings: params.executionError.warnings,
    conversationId: params.executionError.conversationId,
    conversationDurable: params.executionError.conversationDurable,
  });
  const claimSnapshot = params.store.getJob(params.job.id);
  const settlement = await persistAttemptMutation(
    () =>
      params.store.recordRunDeferral(
        params.job.id,
        params.attemptId,
        params.job.definitionRevision,
        params.completedAtMs,
        params.error,
        report,
      ),
    () =>
      params.store.restoreJobAttemptClaim({
        id: params.job.id,
        attemptId: params.attemptId,
        startedAtMs: params.claimedAtMs,
        definitionRevision: params.job.definitionRevision,
        attempt: params.attempt,
        claimSnapshot,
      }),
  );
  if (settlement.status === 'not_owned') return { status: 'failed', error: params.error };
  if (settlement.status === 'persistence_failed') {
    scheduleAmbiguousSettlementRecovery({
      job: params.job,
      attemptId: params.attemptId,
      attempt: params.attempt,
      startedAt: params.startedAtMs,
      trigger: params.trigger,
    });
    return { status: 'failed', error: params.error };
  }
  if (params.store.getJob(params.job.id)?.nextRetryAtMs === undefined) {
    return { status: 'skipped', reason: 'ineligible' };
  }
  await emitActiveSchedulerEvent('task_retrying', {
    taskId: params.job.id,
    error: params.error,
    attempt: params.attempt,
    maxRetries: params.maxRetries,
  });
  await drainSchedulerTerminalReports().catch((reportError) =>
    console.warn('[scheduler] Background deferral report remains queued:', reportError),
  );
  return { status: 'retrying', error: params.error };
}

export function settleSafeBackgroundAbort(
  params: SafeDeferralParams & { executionError: SchedulerAppBackgroundAbortError },
) {
  return settleSafeDeferral(params);
}

export async function settleProjectionBusyDeferral(
  params: SafeDeferralParams & { executionError: SchedulerProjectionBusyError },
): Promise<
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: 'conversation_busy' | 'ineligible' }
> {
  const result = await settleSafeDeferral(params);
  if (result.status === 'failed') return { status: 'failed', error: result.error };
  if (result.status === 'skipped') return result;
  return { status: 'skipped', reason: 'conversation_busy' };
}
