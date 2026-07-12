// ---------------------------------------------------------------------------
// Kavi — Scheduler Engine
// ---------------------------------------------------------------------------
// Evaluates scheduled jobs with persisted next-run, retry, and attempt state.

import { AppState } from 'react-native';
import { useSchedulerStore } from './store';
import { syncSchedulerWakeNotifications } from './wakeNotifications';
import type { CronJob, SchedulerTrigger } from '../cron/types';
import { emitSchedulerEvent } from '../events/bus';
import { emitActiveSchedulerEvent } from './activeSchedulerEvent';
import { generateId } from '../../utils/id';
import { unrefTimerIfSupported } from '../../utils/timers';
import {
  isNonRetryableSchedulerExecutionError,
  isSchedulerAppBackgroundAbortError,
  isSchedulerCompletionCheckpointError,
  isSchedulerProjectionBusyError,
  isSchedulerProjectionReleaseError,
  resolveSchedulerExecutionWarnings,
  SchedulerAppBackgroundAbortError,
  SchedulerExecutionError,
} from './executionError';
import { flushSchedulerStorePersistenceNow } from './persistence';
import { ensureSchedulerRuntimeReady } from './runtimeReadiness';
import type { SchedulerExecutionResult } from './executionResult';
import {
  MAX_CONCURRENT_SCHEDULER_EXECUTIONS,
  tryWithSchedulerExecutionSlot,
  withSchedulerOperationLock,
} from './operationLock';
import { waitForPersistedAgentRecoveryReadiness } from '../startupRecovery';
import { shouldRunScheduledJob } from './eligibility';
import { scheduleSchedulerStatePersistenceRecovery } from './statePersistenceRecovery';
import { getSchedulerRetryDelay, maxRetriesForScheduledJob } from './retryPolicy';
import { buildSchedulerTerminalReport, sanitizeSchedulerReportText } from './terminalReport';
import {
  drainSchedulerTerminalReports,
  setSchedulerTerminalReportNotifiers,
} from './terminalReportProcessor';
import { persistAttemptMutation, scheduleAmbiguousSettlementRecovery } from './attemptRecovery';
import { MAX_TERMINAL_REPORTS } from './storeModel';
import {
  settleProjectionBusyDeferral,
  settleSafeBackgroundAbort,
} from './backgroundAbortSettlement';
import { fenceUnjournaledScheduledHooks } from './hookReplayFence';
import { settleSuccessfulScheduledRun } from './successfulRunSettlement';
import {
  getScheduledExecutionLifecycleEpoch,
  isScheduledExecutionLifecycleEpochCurrent,
  registerScheduledJobExecution,
  ScheduledAppBackgroundAbortReason,
  type ScheduledExecutionContext,
} from './executionLifecycle';
import {
  buildRunJobNowResult,
  type RunJobNowResult,
  type SchedulerJobExecutionOutcome,
} from './runJobNowResult';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerStartPromise: Promise<void> | null = null;
let schedulerStartRequested = false;
const CHECK_INTERVAL_MS = 60_000;
const pendingExecutionJobIds = new Set<string>();

export interface SchedulerExecutor {
  execute: (job: CronJob, context: ScheduledExecutionContext) => Promise<SchedulerExecutionResult>;
  onSuccess?: (
    job: CronJob,
    result: SchedulerExecutionResult,
    notificationIdentifier?: string,
  ) => Promise<void>;
  onFinalFailure?: (job: CronJob, error: unknown, notificationIdentifier?: string) => Promise<void>;
}

export interface EvaluateJobsOptions {
  nowMs?: number;
  trigger?: SchedulerTrigger;
  targetJobId?: string;
  force?: boolean;
  timeBudgetMs?: number;
}

let executor: SchedulerExecutor | null = null;

export function setSchedulerExecutor(exec: SchedulerExecutor | null): void {
  executor = exec;
  setSchedulerTerminalReportNotifiers(exec?.onSuccess, exec?.onFinalFailure);
}

// ── Core evaluation ─────────────────────────────────────────────────────

async function executeJobExclusive(
  job: CronJob,
  nowMs: number,
  trigger: SchedulerTrigger,
  force: boolean,
): Promise<SchedulerJobExecutionOutcome> {
  const store = useSchedulerStore.getState();
  const lifecycleEpoch = getScheduledExecutionLifecycleEpoch();
  const attemptId = `attempt-${generateId()}`;
  const claimOutcome = await withSchedulerOperationLock(async () => {
    const currentJob = store.getJob(job.id);
    if (!currentJob || !shouldRunScheduledJob(currentJob, nowMs, force)) {
      return { claim: undefined };
    }
    const claim = store.tryClaimJobAttempt({
      id: job.id,
      attemptId,
      timestamp: nowMs,
      force,
    });
    if (!claim) return { claim };
    try {
      await flushSchedulerStorePersistenceNow();
      return { claim };
    } catch (persistenceError) {
      return { claim, persistenceError };
    }
  });
  const { claim } = claimOutcome;
  if (!claim) {
    return {
      status: 'skipped',
      reason: store.getJob(job.id)?.runningAttemptId ? 'job_busy' : 'ineligible',
    };
  }
  const { job: claimedJob, attempt } = claim;
  const jobExecutor = executor;

  if ('persistenceError' in claimOutcome) {
    const claimPersistenceError = claimOutcome.persistenceError;
    const error = sanitizeSchedulerReportText(
      `Unable to persist the scheduled attempt claim: ${
        claimPersistenceError instanceof Error
          ? claimPersistenceError.message
          : String(claimPersistenceError)
      }`,
    );
    const completedAt = Date.now();
    const release = await persistAttemptMutation(() =>
      store.releaseJobAttemptClaim({
        id: claimedJob.id,
        attemptId,
        timestamp: completedAt,
        error,
        report: buildSchedulerTerminalReport({
          attemptId,
          job: claimedJob,
          status: 'retrying',
          notification: 'none',
          startedAtMs: nowMs,
          completedAtMs: completedAt,
          attempt,
          trigger,
          error,
        }),
      }),
    );
    if (release.status === 'not_owned') return { status: 'retrying', error };
    if (release.status === 'persistence_failed') {
      console.warn('[scheduler] Failed to persist the released claim:', release.error);
      scheduleSchedulerStatePersistenceRecovery('Released claim state');
    } else {
      await drainSchedulerTerminalReports().catch((reportError) =>
        console.warn('[scheduler] Claim deferral report remains queued:', reportError),
      );
    }
    await emitActiveSchedulerEvent('task_retrying', {
      taskId: claimedJob.id,
      error,
      attempt,
      maxRetries: maxRetriesForScheduledJob(claimedJob),
    });
    return { status: 'retrying', error };
  }

  if (store.getJob(claimedJob.id)?.runningAttemptId !== attemptId) {
    return { status: 'skipped', reason: 'job_busy' };
  }

  const hookFence = await fenceUnjournaledScheduledHooks(store, claimedJob.id, attemptId);
  if (hookFence.status !== 'not_required') {
    if (hookFence.status === 'not_owned') return { status: 'skipped', reason: 'job_busy' };
    if (hookFence.status === 'persistence_failed') {
      scheduleAmbiguousSettlementRecovery({
        job: claimedJob,
        attemptId,
        attempt,
        startedAt: nowMs,
        trigger,
      });
      return {
        status: 'failed',
        error:
          'Scheduled execution was deferred because its hook replay fence could not be persisted.',
      };
    }
  }

  const startMs = Date.now();

  try {
    const hookExecution = registerScheduledJobExecution(claimedJob.id, lifecycleEpoch);
    try {
      hookExecution.throwIfBackgrounded();
      await emitSchedulerEvent('task_run', {
        taskId: claimedJob.id,
        taskName: claimedJob.name,
        agentRunId: attemptId,
        executionSignal: hookExecution.controller,
      });
      hookExecution.throwIfBackgrounded();
    } catch (error: unknown) {
      if (error instanceof ScheduledAppBackgroundAbortReason) {
        throw new SchedulerAppBackgroundAbortError(error);
      }
      throw error;
    } finally {
      hookExecution.unregister();
    }

    if (!jobExecutor) {
      const error = 'No executor configured';
      const completedAt = Date.now();
      const claimSnapshot = store.getJob(claimedJob.id);
      const settlement = await persistAttemptMutation(
        () =>
          store.recordRunFailure(
            claimedJob.id,
            attemptId,
            claimedJob.definitionRevision,
            { timestamp: completedAt, error, attempt, final: true },
            buildSchedulerTerminalReport({
              attemptId,
              job: claimedJob,
              status: 'error',
              notification: 'failure',
              startedAtMs: startMs,
              completedAtMs: completedAt,
              attempt,
              trigger,
              error,
            }),
          ),
        () =>
          store.restoreJobAttemptClaim({
            id: claimedJob.id,
            attemptId,
            startedAtMs: nowMs,
            definitionRevision: claimedJob.definitionRevision,
            attempt,
            claimSnapshot,
          }),
      );
      if (settlement.status === 'not_owned') return { status: 'failed', error };
      if (settlement.status === 'persistence_failed') {
        console.warn(
          '[scheduler] Failed to persist missing-executor settlement:',
          settlement.error,
        );
        scheduleAmbiguousSettlementRecovery({
          job: claimedJob,
          attemptId,
          attempt,
          startedAt: nowMs,
          trigger,
        });
        return { status: 'failed', error };
      }
      await emitActiveSchedulerEvent('task_failed', { taskId: claimedJob.id, error });
      await drainSchedulerTerminalReports().catch((reportError) =>
        console.warn('[scheduler] Missing-executor report remains queued:', reportError),
      );
      return { status: 'failed', error };
    }

    if (
      AppState.currentState !== 'active' ||
      !isScheduledExecutionLifecycleEpochCurrent(lifecycleEpoch)
    ) {
      throw new SchedulerAppBackgroundAbortError(new ScheduledAppBackgroundAbortReason());
    }
    const result = await jobExecutor.execute(claimedJob, { lifecycleEpoch });
    return settleSuccessfulScheduledRun({
      store,
      job: claimedJob,
      result,
      attemptId,
      attempt,
      claimedAtMs: nowMs,
      startedAtMs: startMs,
      completedAtMs: Date.now(),
      trigger,
    });
  } catch (err: unknown) {
    const completedAt = Date.now();
    if (
      isSchedulerCompletionCheckpointError(err) ||
      (isSchedulerProjectionReleaseError(err) && err.completionPreserved)
    ) {
      scheduleAmbiguousSettlementRecovery({
        job: claimedJob,
        attemptId,
        attempt,
        startedAt: startMs,
        trigger,
      });
      return { status: 'failed', error: err.message };
    }
    if (isSchedulerProjectionBusyError(err)) {
      const currentJob = store.getJob(claimedJob.id);
      const maxRetries = currentJob?.enabled ? maxRetriesForScheduledJob(currentJob) : 0;
      return settleProjectionBusyDeferral({
        store,
        job: claimedJob,
        attemptId,
        attempt,
        startedAtMs: startMs,
        claimedAtMs: nowMs,
        completedAtMs: completedAt,
        trigger,
        error: sanitizeSchedulerReportText(err.message),
        executionError: err,
        maxRetries,
      });
    }
    const backgroundAbort = isSchedulerAppBackgroundAbortError(err);
    const currentAttemptState = store.getJob(claimedJob.id);
    const replayUnsafe = currentAttemptState?.runningEffectRisk === 'unsafe';
    const backgroundReplaySafe =
      backgroundAbort && currentAttemptState?.runningEffectRisk === 'safe';
    const sourceError = err instanceof Error ? err.message : String(err);
    const error = sanitizeSchedulerReportText(
      backgroundAbort && !backgroundReplaySafe
        ? 'Scheduled task stopped in the background after a durable effect claim; replay was suppressed.'
        : replayUnsafe
          ? `Scheduled task failed after a durable hook or effect claim; replay was suppressed. ${sourceError}`
          : sourceError,
    );
    const currentJob = store.getJob(claimedJob.id);
    const definitionChanged = currentJob?.definitionRevision !== claimedJob.definitionRevision;
    const maxRetries =
      definitionChanged || !currentJob?.enabled ? 0 : maxRetriesForScheduledJob(currentJob);
    const willRetry =
      !backgroundAbort &&
      !replayUnsafe &&
      !isNonRetryableSchedulerExecutionError(err) &&
      attempt <= maxRetries;
    const executionWarnings = resolveSchedulerExecutionWarnings(err);

    if (backgroundReplaySafe) {
      return settleSafeBackgroundAbort({
        store,
        job: claimedJob,
        attemptId,
        attempt,
        startedAtMs: startMs,
        claimedAtMs: nowMs,
        completedAtMs: completedAt,
        trigger,
        error,
        executionError: err,
        maxRetries,
      });
    }

    if (willRetry) {
      const nextRetryAtMs = completedAt + getSchedulerRetryDelay(attempt);
      const settlement = await persistAttemptMutation(
        () =>
          store.recordRunFailure(
            claimedJob.id,
            attemptId,
            claimedJob.definitionRevision,
            { timestamp: completedAt, error, attempt, nextRetryAtMs, final: false },
            buildSchedulerTerminalReport({
              attemptId,
              job: claimedJob,
              status: 'retrying',
              notification: 'none',
              startedAtMs: startMs,
              completedAtMs: completedAt,
              attempt,
              trigger,
              error,
              warnings: executionWarnings,
              conversationId:
                err instanceof SchedulerExecutionError ? err.conversationId : undefined,
              conversationDurable:
                err instanceof SchedulerExecutionError ? err.conversationDurable : undefined,
            }),
          ),
        () =>
          store.restoreJobAttemptClaim({
            id: claimedJob.id,
            attemptId,
            startedAtMs: nowMs,
            definitionRevision: claimedJob.definitionRevision,
            attempt,
            claimSnapshot: currentJob,
          }),
      );
      if (settlement.status === 'not_owned') return { status: 'failed', error };
      if (settlement.status === 'persistence_failed') {
        console.warn('[scheduler] Failed to persist retry settlement:', settlement.error);
        scheduleAmbiguousSettlementRecovery({
          job: claimedJob,
          attemptId,
          attempt,
          startedAt: startMs,
          trigger,
        });
        return { status: 'failed', error };
      }
      await emitActiveSchedulerEvent('task_retrying', {
        taskId: claimedJob.id,
        error,
        attempt,
        maxRetries,
      });
      await drainSchedulerTerminalReports().catch((reportError) =>
        console.warn('[scheduler] Retry report remains queued:', reportError),
      );
      return { status: 'retrying', error };
    }

    const settlement = await persistAttemptMutation(
      () =>
        store.recordRunFailure(
          claimedJob.id,
          attemptId,
          claimedJob.definitionRevision,
          { timestamp: completedAt, error, attempt, final: true },
          buildSchedulerTerminalReport({
            attemptId,
            job: claimedJob,
            status: 'error',
            notification: 'failure',
            startedAtMs: startMs,
            completedAtMs: completedAt,
            attempt,
            trigger,
            error,
            warnings: executionWarnings,
            conversationId: err instanceof SchedulerExecutionError ? err.conversationId : undefined,
            conversationDurable:
              err instanceof SchedulerExecutionError ? err.conversationDurable : undefined,
          }),
        ),
      () =>
        store.restoreJobAttemptClaim({
          id: claimedJob.id,
          attemptId,
          startedAtMs: nowMs,
          definitionRevision: claimedJob.definitionRevision,
          attempt,
          claimSnapshot: currentJob,
        }),
    );
    if (settlement.status === 'not_owned') return { status: 'failed', error };
    if (settlement.status === 'persistence_failed') {
      console.warn('[scheduler] Failed to persist final failure settlement:', settlement.error);
      scheduleAmbiguousSettlementRecovery({
        job: claimedJob,
        attemptId,
        attempt,
        startedAt: startMs,
        trigger,
      });
      return { status: 'failed', error };
    }
    await emitActiveSchedulerEvent('task_failed', { taskId: claimedJob.id, error });
    await drainSchedulerTerminalReports().catch((reportError) =>
      console.warn('[scheduler] Final failure report remains queued:', reportError),
    );
    return { status: 'failed', error };
  }
}

async function executeJob(
  job: CronJob,
  nowMs: number,
  trigger: SchedulerTrigger,
  force: boolean,
): Promise<SchedulerJobExecutionOutcome> {
  await ensureSchedulerRuntimeReady();
  if (pendingExecutionJobIds.has(job.id)) return { status: 'skipped', reason: 'job_busy' };
  const reportCapacityThreshold = MAX_TERMINAL_REPORTS - MAX_CONCURRENT_SCHEDULER_EXECUTIONS;
  if (useSchedulerStore.getState().terminalReports.length >= reportCapacityThreshold) {
    await drainSchedulerTerminalReports().catch((error) =>
      console.warn('[scheduler] Terminal report backlog remains queued:', error),
    );
    if (useSchedulerStore.getState().terminalReports.length >= reportCapacityThreshold) {
      return { status: 'skipped', reason: 'report_backlog' };
    }
  }
  pendingExecutionJobIds.add(job.id);
  try {
    const execution = await tryWithSchedulerExecutionSlot(async () => {
      await waitForPersistedAgentRecoveryReadiness();
      if (AppState.currentState !== 'active') {
        return { status: 'skipped', reason: 'inactive' } as const;
      }
      const effectiveNowMs = Math.max(nowMs, Date.now());
      const currentJob = useSchedulerStore.getState().getJob(job.id);
      if (!currentJob) return { status: 'skipped', reason: 'ineligible' } as const;
      return executeJobExclusive(currentJob, effectiveNowMs, trigger, force);
    });
    return execution.acquired
      ? execution.value
      : {
          status: 'skipped',
          reason: execution.reason === 'capacity' ? 'capacity_busy' : 'recovery_busy',
        };
  } finally {
    pendingExecutionJobIds.delete(job.id);
  }
}

async function maintainWakeNotifications(
  nowMs: number,
  force: boolean,
  preserveDueWake = false,
): Promise<string | undefined> {
  try {
    const { warnings } = await syncSchedulerWakeNotifications({
      nowMs,
      force: force || preserveDueWake,
      preserveDueWake,
    });
    if (warnings.length === 0) return undefined;
    const warning = warnings.join(' ');
    console.warn('[scheduler] Wake notification maintenance warning:', warning);
    return warning;
  } catch (error) {
    const warning = `Wake notification maintenance failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    console.warn('[scheduler] Wake notification maintenance failed:', error);
    return warning;
  }
}

async function evaluateJobs(options: EvaluateJobsOptions = {}): Promise<void> {
  await ensureSchedulerRuntimeReady();
  const startedAtMs = Date.now();
  const nowMs = options.nowMs ?? startedAtMs;
  const trigger = options.trigger ?? 'scheduled';
  const store = useSchedulerStore.getState();
  const candidates = options.targetJobId
    ? store.jobs.filter((job) => job.id === options.targetJobId)
    : store
        .getEnabledJobs()
        .filter((job) => shouldRunScheduledJob(job, nowMs, options.force === true));
  let preserveDueWake = false;
  const queue = [...candidates];
  const worker = async () => {
    while (queue.length > 0) {
      if (
        options.timeBudgetMs !== undefined &&
        Date.now() - startedAtMs >= Math.max(0, options.timeBudgetMs)
      ) {
        preserveDueWake = true;
        return;
      }
      const job = queue.shift();
      if (!job) return;
      await executeJob(job, nowMs, trigger, options.force === true);
      const latestJob = store.getJob(job.id);
      if (
        latestJob?.runningAttemptId ||
        (latestJob && shouldRunScheduledJob(latestJob, Math.max(nowMs, Date.now()), false))
      ) {
        preserveDueWake = true;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_SCHEDULER_EXECUTIONS, queue.length) }, worker),
  );

  await maintainWakeNotifications(nowMs, false, preserveDueWake);
}

export function startScheduler(): Promise<void> {
  schedulerStartRequested = true;
  if (schedulerInterval) return Promise.resolve();
  if (schedulerStartPromise) return schedulerStartPromise;

  schedulerStartPromise = ensureSchedulerRuntimeReady()
    .then(async () => {
      do {
        if (!schedulerStartRequested || schedulerInterval) return;
        schedulerInterval = setInterval(() => {
          void evaluateJobs({ trigger: 'scheduled' }).catch(console.error);
        }, CHECK_INTERVAL_MS);
        unrefTimerIfSupported(schedulerInterval);
        await evaluateJobs({ trigger: 'scheduled' });
      } while (schedulerStartRequested && !schedulerInterval);
    })
    .finally(() => {
      schedulerStartPromise = null;
    });
  return schedulerStartPromise;
}

/** Run a single evaluation pass. Used by background tasks and lifecycle hooks. */
export async function evaluateJobsOnce(options: EvaluateJobsOptions = {}): Promise<void> {
  return evaluateJobs(options);
}

export async function runJobNow(
  jobId: string,
  options: Omit<EvaluateJobsOptions, 'targetJobId'> = {},
): Promise<RunJobNowResult> {
  await ensureSchedulerRuntimeReady();
  const job = useSchedulerStore.getState().getJob(jobId);
  if (!job) return { status: 'not_found', id: jobId };

  const nowMs = options.nowMs ?? Date.now();
  const result = await executeJob(job, nowMs, options.trigger ?? 'manual', options.force ?? true);
  const latestJob = useSchedulerStore.getState().getJob(job.id);
  const preserveDueWake = Boolean(
    latestJob?.runningAttemptId ||
    (latestJob && shouldRunScheduledJob(latestJob, Math.max(nowMs, Date.now()), false)),
  );
  const wakeWarning = await maintainWakeNotifications(nowMs, false, preserveDueWake);
  return buildRunJobNowResult({ job, outcome: result, wakeWarning });
}

export function stopScheduler(): void {
  schedulerStartRequested = false;
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/** Reset retry state for a specific job (e.g., after manual edit). */
export function resetJobRetry(jobId: string): void {
  useSchedulerStore.getState().resetJobRetry(jobId);
}
