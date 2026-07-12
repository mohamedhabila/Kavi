import type { CronJob, SchedulerTrigger } from '../cron/types';
import { emitActiveSchedulerEvent } from './activeSchedulerEvent';
import type { SchedulerExecutionResult } from './executionResult';
import { persistAttemptMutation, scheduleAmbiguousSettlementRecovery } from './attemptRecovery';
import type { useSchedulerStore } from './store';
import { buildSchedulerTerminalReport } from './terminalReport';
import { drainSchedulerTerminalReports } from './terminalReportProcessor';
import { commitPendingVerifiedProcedureObservation } from '../memory/verifiedProcedure/executionSession';

export async function settleSuccessfulScheduledRun(params: {
  store: ReturnType<typeof useSchedulerStore.getState>;
  job: CronJob;
  result: SchedulerExecutionResult;
  attemptId: string;
  attempt: number;
  claimedAtMs: number;
  startedAtMs: number;
  completedAtMs: number;
  trigger: SchedulerTrigger;
}): Promise<{ status: 'succeeded'; warning?: string } | { status: 'failed'; error: string }> {
  const attemptState = params.store.getJob(params.job.id);
  const completion = attemptState?.runningCompletion ?? {
    completedAtMs: params.completedAtMs,
    output: params.result.output,
    conversationId: params.result.conversationId,
    conversationDurable: params.result.conversationDurable,
    warnings: params.result.warnings,
  };
  let persistenceError: string | undefined;
  const settlement = await persistAttemptMutation(
    () =>
      params.store.recordRun(
        params.job.id,
        params.attemptId,
        params.job.definitionRevision,
        params.completedAtMs,
        buildSchedulerTerminalReport({
          attemptId: params.attemptId,
          job: params.job,
          status: 'success',
          notification: 'success',
          startedAtMs: params.startedAtMs,
          completedAtMs: params.completedAtMs,
          attempt: params.attempt,
          trigger: params.trigger,
          output: params.result.output,
          warnings: params.result.warnings,
          conversationId: params.result.conversationId,
          conversationDurable: params.result.conversationDurable,
        }),
      ),
    (error) => {
      persistenceError = `Scheduled work completed, but terminal scheduler state could not be persisted: ${
        error instanceof Error ? error.message : String(error)
      }`;
      params.store.restoreJobAttemptClaim({
        id: params.job.id,
        attemptId: params.attemptId,
        startedAtMs: params.claimedAtMs,
        definitionRevision: params.job.definitionRevision,
        attempt: params.attempt,
        error: persistenceError,
        conversationId: attemptState?.runningConversationId ?? params.result.conversationId,
        effectRisk: attemptState?.runningEffectRisk,
        occurrenceId: attemptState?.runningOccurrenceId,
        completion,
        claimSnapshot: attemptState,
      });
    },
  );
  if (settlement.status === 'not_owned') {
    return { status: 'failed', error: 'Scheduled attempt ownership was lost before settlement.' };
  }
  if (settlement.status === 'persistence_failed') {
    const error = persistenceError ?? 'Terminal scheduler state persistence failed.';
    scheduleAmbiguousSettlementRecovery({
      job: params.job,
      attemptId: params.attemptId,
      attempt: params.attempt,
      startedAt: params.startedAtMs,
      trigger: params.trigger,
    });
    return { status: 'failed', error };
  }
  if (params.result.pendingVerifiedProcedureCommit) {
    await commitPendingVerifiedProcedureObservation({
      memoryLineage: params.result.pendingVerifiedProcedureCommit.memoryLineage,
      pending: params.result.pendingVerifiedProcedureCommit.observation,
      surface: 'scheduler',
      terminalObservedAt: Date.now(),
    }).catch(() => {
      // Procedure learning is ancillary and cannot alter a durably successful task.
    });
  }
  await emitActiveSchedulerEvent('task_complete', {
    taskId: params.job.id,
    taskName: params.job.name,
  });
  let reportWarning: string | undefined;
  await drainSchedulerTerminalReports().catch((error) => {
    reportWarning = `Terminal report remains queued: ${
      error instanceof Error ? error.message : String(error)
    }`;
    console.warn('[scheduler] Success report remains queued:', error);
  });
  const warning = [
    ...(params.result.warnings ?? []),
    params.store.getJob(params.job.id)?.lastDeliveryError,
    reportWarning,
  ]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .join(' ');
  return { status: 'succeeded', ...(warning ? { warning } : {}) };
}
