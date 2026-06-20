// ---------------------------------------------------------------------------
// Kavi — Scheduler Store (Zustand)
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../../utils/id';
import { computeNextRunAtMs } from '../cron/schedule';
import type {
  CronJob,
  CronJobRuntimeState,
  CronSchedule,
  SessionTarget,
  SchedulerTrigger,
  WakeMode,
} from '../cron/types';

type RuntimeStateUpdate = Partial<CronJobRuntimeState>;

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
  }) => string;
  updateJob: (
    id: string,
    updates: Partial<Pick<CronJob, 'name' | 'schedule' | 'payload' | 'enabled' | 'delivery'>>,
  ) => void;
  removeJob: (id: string) => void;
  enableJob: (id: string) => void;
  disableJob: (id: string) => void;
  markJobAttemptStarted: (id: string, attemptId: string, timestamp: number) => void;
  recordRun: (id: string, timestamp: number) => void;
  recordRunFailure: (id: string, update: RunFailureUpdate) => void;
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

function normalizedRetryAttempts(value: unknown): number {
  const parsed = coerceFiniteNumber(value);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
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
    retryAttempts: normalizedRetryAttempts(job.retryAttempts),
    nextRetryAtMs: finiteTimestamp(job.nextRetryAtMs),
    runningAttemptId: undefined,
    runningStartedAtMs: undefined,
    pendingWakeNotificationId: job.pendingWakeNotificationId,
    lastWakeAtMs: finiteTimestamp(job.lastWakeAtMs),
    lastWakeSource: job.lastWakeSource,
    wakePolicy: job.wakePolicy || 'try_background_then_notify',
  };
}

function clearTransientRunState(job: CronJob): CronJob {
  return {
    ...job,
    retryAttempts: 0,
    nextRetryAtMs: undefined,
    runningAttemptId: undefined,
    runningStartedAtMs: undefined,
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
            return scheduleRuntime ? clearTransientRunState(updated) : updated;
          }),
        })),

      removeJob: (id) => set((state) => ({ jobs: state.jobs.filter((j) => j.id !== id) })),

      enableJob: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) => {
            if (j.id !== id) return j;
            const now = Date.now();
            const scheduleRuntime = prepareScheduleRuntime(j.schedule, now);
            return clearTransientRunState({
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
            j.id === id
              ? clearTransientRunState({ ...j, enabled: false, updatedAtMs: Date.now() })
              : j,
          ),
        })),

      markJobAttemptStarted: (id, attemptId, timestamp) =>
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  lastAttemptAtMs: timestamp,
                  runningAttemptId: attemptId,
                  runningStartedAtMs: timestamp,
                  updatedAtMs: Date.now(),
                }
              : j,
          ),
        })),

      recordRun: (id, timestamp) =>
        set((state) => ({
          jobs: state.jobs.map((j) => {
            if (j.id !== id) return j;
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
        })),

      recordRunFailure: (id, update) =>
        set((state) => ({
          jobs: state.jobs.map((j) => {
            if (j.id !== id) return j;
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
                  runningAttemptId: undefined,
                  runningStartedAtMs: undefined,
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
      name: 'kavi-scheduler',
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
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
        return nextState;
      },
    },
  ),
);
