// ---------------------------------------------------------------------------
// Kavi — Scheduler Store (Zustand)
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { generateId } from '../../utils/id';
import { computeNextRunAtMs } from '../cron/schedule';
import { SCHEDULER_STORE_KEY, schedulerStateStorage } from './persistence';
import { normalizeSchedulerRetryAttempts, shouldRunScheduledJob } from './eligibility';
import type {
  CronJob,
  CronJobRuntimeState,
  CronSchedule,
  SessionTarget,
  SchedulerTrigger,
  CronFailureAlert,
  WakeMode,
} from '../cron/types';

type RuntimeStateUpdate = Partial<
  Omit<CronJobRuntimeState, 'runningAttemptId' | 'runningStartedAtMs'>
>;

type RunFailureUpdate = {
  timestamp: number;
  error: string;
  attempt: number;
  nextRetryAtMs?: number;
  final: boolean;
};

interface SchedulerState {
  jobs: CronJob[];
  lastEvaluationAtMs?: number;

  addJob: (params: {
    name: string;
    schedule: CronSchedule;
    prompt: string;
    model?: string;
    providerId?: string;
    sessionTarget?: SessionTarget;
    wakeMode?: WakeMode;
    deliveryMode?: 'conversation' | 'notification' | 'both';
    failureAlert?: CronFailureAlert;
  }) => string;
  updateJob: (
    id: string,
    updates: Partial<
      Pick<CronJob, 'name' | 'schedule' | 'payload' | 'enabled' | 'delivery' | 'failureAlert'>
    >,
  ) => void;
  removeJob: (id: string) => boolean;
  enableJob: (id: string) => void;
  disableJob: (id: string) => void;
  tryClaimJobAttempt: (params: {
    id: string;
    attemptId: string;
    timestamp: number;
    force: boolean;
  }) => { job: CronJob; attempt: number } | undefined;
  reconcileStrandedAttempts: (timestamp: number) => CronJob[];
  recordRun: (id: string, attemptId: string, timestamp: number) => boolean;
  recordRunFailure: (id: string, attemptId: string, update: RunFailureUpdate) => boolean;
  restoreJobAttemptClaim: (params: {
    id: string;
    attemptId: string;
    startedAtMs: number;
    error?: string;
  }) => void;
  resetJobRetry: (id: string) => void;
  updateJobRuntimeState: (id: string, updates: RuntimeStateUpdate) => void;
  recordEvaluation: (timestamp: number, trigger?: SchedulerTrigger) => void;
  getJob: (id: string) => CronJob | undefined;
  getEnabledJobs: () => CronJob[];
}

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteTimestamp(value: unknown): number | undefined {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined) return undefined;
  return parsed > 0 ? Math.floor(parsed) : undefined;
}

function withStableEveryAnchor(schedule: CronSchedule, nowMs: number): CronSchedule {
  if (schedule.kind !== 'every') return schedule;
  const anchorMs = finiteTimestamp(schedule.anchorMs);
  return anchorMs === undefined ? { ...schedule, anchorMs: nowMs } : schedule;
}

function safeComputeNextRunAtMs(schedule: CronSchedule, nowMs: number): number | undefined {
  try {
    return finiteTimestamp(computeNextRunAtMs(schedule, nowMs));
  } catch {
    return undefined;
  }
}

function prepareScheduleRuntime(schedule: CronSchedule, nowMs: number) {
  const stableSchedule = withStableEveryAnchor(schedule, nowMs);
  return {
    schedule: stableSchedule,
    nextRunAtMs: safeComputeNextRunAtMs(stableSchedule, nowMs),
  };
}

function shouldDisableAfterRun(job: CronJob): boolean {
  return job.schedule.kind === 'at' || job.deleteAfterRun === true;
}

function normalizePersistedJob(job: CronJob, nowMs: number): CronJob {
  const scheduleRuntime = prepareScheduleRuntime(job.schedule, job.createdAtMs || nowMs);
  return {
    ...job,
    schedule: scheduleRuntime.schedule,
    nextRunAtMs: finiteTimestamp(job.nextRunAtMs) ?? scheduleRuntime.nextRunAtMs,
    lastRunAtMs: finiteTimestamp(job.lastRunAtMs),
    lastAttemptAtMs: finiteTimestamp(job.lastAttemptAtMs),
    lastSuccessAtMs: finiteTimestamp(job.lastSuccessAtMs),
    lastFailureAtMs: finiteTimestamp(job.lastFailureAtMs),
    retryAttempts: normalizeSchedulerRetryAttempts(job.retryAttempts),
    nextRetryAtMs: finiteTimestamp(job.nextRetryAtMs),
    runningAttemptId: job.runningAttemptId?.trim() || undefined,
    runningStartedAtMs: finiteTimestamp(job.runningStartedAtMs),
    lastAmbiguousAttemptId: job.lastAmbiguousAttemptId?.trim() || undefined,
    lastAmbiguousAtMs: finiteTimestamp(job.lastAmbiguousAtMs),
    pendingWakeNotificationId: job.pendingWakeNotificationId,
    pendingWakeNotificationRunAtMs: finiteTimestamp(job.pendingWakeNotificationRunAtMs),
    lastWakeAtMs: finiteTimestamp(job.lastWakeAtMs),
    lastWakeSource: job.lastWakeSource,
    wakePolicy: job.wakePolicy || 'try_background_then_notify',
  };
}

function clearRetryState(job: CronJob): CronJob {
  return {
    ...job,
    retryAttempts: 0,
    nextRetryAtMs: undefined,
  };
}

export const useSchedulerStore = create<SchedulerState>()(
  persist(
    (set, get) => ({
      jobs: [],
      lastEvaluationAtMs: undefined,

      addJob: (params) => {
        const id = generateId();
        const now = Date.now();
        const scheduleRuntime = prepareScheduleRuntime(params.schedule, now);
        const job: CronJob = {
          id,
          name: params.name,
          enabled: true,
          createdAtMs: now,
          updatedAtMs: now,
          schedule: scheduleRuntime.schedule,
          sessionTarget: params.sessionTarget || 'isolated',
          wakeMode: params.wakeMode || 'new',
          payload: {
            prompt: params.prompt,
            model: params.model,
            providerId: params.providerId,
          },
          delivery: {
            mode: params.deliveryMode || 'both',
          },
          failureAlert: params.failureAlert,
          nextRunAtMs: scheduleRuntime.nextRunAtMs,
          retryAttempts: 0,
          wakePolicy: 'try_background_then_notify',
        };
        set((state) => ({ jobs: [...state.jobs, job] }));
        return id;
      },

      updateJob: (id, updates) =>
        set((state) => ({
          jobs: state.jobs.map((j) => {
            if (j.id !== id) return j;
            const now = Date.now();
            const scheduleRuntime = updates.schedule
              ? prepareScheduleRuntime(updates.schedule, now)
              : undefined;
            const updated: CronJob = {
              ...j,
              ...updates,
              ...(scheduleRuntime
                ? {
                    schedule: scheduleRuntime.schedule,
                    nextRunAtMs: scheduleRuntime.nextRunAtMs,
                    lastError: undefined,
                  }
                : {}),
              updatedAtMs: now,
            };
            return scheduleRuntime ? clearRetryState(updated) : updated;
          }),
        })),

      removeJob: (id) => {
        let removed = false;
        set((state) => {
          const job = state.jobs.find((candidate) => candidate.id === id);
          if (!job || job.runningAttemptId) return state;
          removed = true;
          return { jobs: state.jobs.filter((candidate) => candidate.id !== id) };
        });
        return removed;
      },

      enableJob: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) => {
            if (j.id !== id) return j;
            const now = Date.now();
            const scheduleRuntime = prepareScheduleRuntime(j.schedule, now);
            return clearRetryState({
              ...j,
              enabled: true,
              updatedAtMs: now,
              schedule: scheduleRuntime.schedule,
              nextRunAtMs: scheduleRuntime.nextRunAtMs,
              lastError: undefined,
            });
          }),
        })),

      disableJob: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id ? clearRetryState({ ...j, enabled: false, updatedAtMs: Date.now() }) : j,
          ),
        })),

      tryClaimJobAttempt: ({ id, attemptId, timestamp, force }) => {
        let claimed: { job: CronJob; attempt: number } | undefined;
        set((state) => {
          const jobIndex = state.jobs.findIndex((job) => job.id === id);
          if (jobIndex < 0) return state;
          const currentJob = state.jobs[jobIndex];
          if (!shouldRunScheduledJob(currentJob, timestamp, force)) return state;
          const attempt = normalizeSchedulerRetryAttempts(currentJob.retryAttempts) + 1;
          const claimedJob: CronJob = {
            ...currentJob,
            lastAttemptAtMs: timestamp,
            runningAttemptId: attemptId,
            runningStartedAtMs: timestamp,
            updatedAtMs: Date.now(),
          };
          const jobs = [...state.jobs];
          jobs[jobIndex] = claimedJob;
          claimed = { job: claimedJob, attempt };
          return { jobs };
        });
        return claimed;
      },

      reconcileStrandedAttempts: (timestamp) => {
        const reconciled: CronJob[] = [];
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (!job.runningAttemptId) return job;
            const disable = shouldDisableAfterRun(job);
            const nextJob: CronJob = {
              ...job,
              enabled: disable ? false : job.enabled,
              updatedAtMs: Date.now(),
              lastRunAtMs: timestamp,
              lastFailureAtMs: timestamp,
              lastError:
                'A previous scheduled attempt ended without a durable terminal record; replay was suppressed.',
              retryAttempts: 0,
              nextRetryAtMs: undefined,
              lastAmbiguousAttemptId: job.runningAttemptId,
              lastAmbiguousAtMs: timestamp,
              runningAttemptId: undefined,
              runningStartedAtMs: undefined,
              nextRunAtMs: disable ? undefined : safeComputeNextRunAtMs(job.schedule, timestamp),
            };
            reconciled.push(nextJob);
            return nextJob;
          }),
        }));
        return reconciled;
      },

      recordRun: (id, attemptId, timestamp) => {
        let recorded = false;
        set((state) => ({
          jobs: state.jobs.map((j) => {
            if (j.id !== id || j.runningAttemptId !== attemptId) return j;
            recorded = true;
            const disable = shouldDisableAfterRun(j);
            const nextRunAtMs = disable ? undefined : safeComputeNextRunAtMs(j.schedule, timestamp);
            return {
              ...j,
              enabled: disable ? false : j.enabled,
              updatedAtMs: Date.now(),
              lastRunAtMs: timestamp,
              lastAttemptAtMs: timestamp,
              lastSuccessAtMs: timestamp,
              lastError: undefined,
              retryAttempts: 0,
              nextRetryAtMs: undefined,
              runningAttemptId: undefined,
              runningStartedAtMs: undefined,
              nextRunAtMs,
            };
          }),
        }));
        return recorded;
      },

      recordRunFailure: (id, attemptId, update) => {
        let recorded = false;
        set((state) => ({
          jobs: state.jobs.map((j) => {
            if (j.id !== id || j.runningAttemptId !== attemptId) return j;
            recorded = true;
            const disable = update.final && shouldDisableAfterRun(j);
            return {
              ...j,
              enabled: disable ? false : j.enabled,
              updatedAtMs: Date.now(),
              lastRunAtMs: update.final ? update.timestamp : j.lastRunAtMs,
              lastAttemptAtMs: update.timestamp,
              lastFailureAtMs: update.timestamp,
              lastError: update.error,
              retryAttempts: update.final ? 0 : update.attempt,
              nextRetryAtMs: update.final ? undefined : update.nextRetryAtMs,
              runningAttemptId: undefined,
              runningStartedAtMs: undefined,
              nextRunAtMs: update.final
                ? disable
                  ? undefined
                  : safeComputeNextRunAtMs(j.schedule, update.timestamp)
                : j.nextRunAtMs,
            };
          }),
        }));
        return recorded;
      },

      restoreJobAttemptClaim: ({ id, attemptId, startedAtMs, error }) =>
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === id && !job.runningAttemptId
              ? {
                  ...job,
                  runningAttemptId: attemptId,
                  runningStartedAtMs: startedAtMs,
                  ...(error ? { lastError: error } : {}),
                  updatedAtMs: Date.now(),
                }
              : job,
          ),
        })),

      resetJobRetry: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  updatedAtMs: Date.now(),
                  retryAttempts: 0,
                  nextRetryAtMs: undefined,
                  lastError: undefined,
                }
              : j,
          ),
        })),

      updateJobRuntimeState: (id, updates) =>
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id ? { ...j, ...updates, updatedAtMs: Date.now() } : j,
          ),
        })),

      recordEvaluation: (timestamp) =>
        set(() => ({
          lastEvaluationAtMs: timestamp,
        })),

      getJob: (id) => get().jobs.find((j) => j.id === id),
      getEnabledJobs: () => get().jobs.filter((j) => j.enabled),
    }),
    {
      name: SCHEDULER_STORE_KEY,
      storage: createJSONStorage(() => schedulerStateStorage),
      version: 4,
      migrate: (persistedState: any, version) => {
        if (!persistedState) return persistedState;
        let nextState = persistedState;
        if (version < 2) {
          nextState = {
            ...persistedState,
            jobs: Array.isArray(persistedState.jobs)
              ? persistedState.jobs.map((job: CronJob) => ({
                  ...job,
                  delivery: {
                    ...job.delivery,
                    mode:
                      job.delivery?.mode === 'notification' || job.delivery?.mode === 'both'
                        ? job.delivery.mode
                        : 'both',
                  },
                }))
              : [],
          };
        }
        if (version < 3) {
          const now = Date.now();
          return {
            ...nextState,
            lastEvaluationAtMs: finiteTimestamp(nextState.lastEvaluationAtMs),
            jobs: Array.isArray(nextState.jobs)
              ? nextState.jobs.map((job: CronJob) => normalizePersistedJob(job, now))
              : [],
          };
        }
        if (version < 4) {
          const now = Date.now();
          return {
            ...nextState,
            lastEvaluationAtMs: finiteTimestamp(nextState.lastEvaluationAtMs),
            jobs: Array.isArray(nextState.jobs)
              ? nextState.jobs.map((job: CronJob) => normalizePersistedJob(job, now))
              : [],
          };
        }
        return nextState;
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SchedulerState> | undefined;
        const now = Date.now();
        return {
          ...currentState,
          ...persisted,
          jobs: Array.isArray(persisted?.jobs)
            ? persisted.jobs.map((job) => normalizePersistedJob(job, now))
            : [],
        };
      },
    },
  ),
);
