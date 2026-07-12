// ---------------------------------------------------------------------------
// Kavi — Scheduler Store (Zustand)
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { generateId } from '../../utils/id';
import { SCHEDULER_STORE_KEY, schedulerStateStorage } from './persistence';
import { normalizeSchedulerRetryAttempts, shouldRunScheduledJob } from './eligibility';
import {
  appendTerminalReport,
  canRetrySafelyInterruptedAttempt,
  clearRetryState,
  deferSafelyInterruptedAttempt,
  haveSameFlatFields,
  normalizePersistedJob,
  normalizeRunningCompletion,
  normalizeTerminalReports,
  prepareScheduleRuntime,
} from './storeModel';
import type { CronJob } from '../cron/types';
import {
  buildReconciledAttemptTerminalReport,
  sanitizeSchedulerReportText,
  sanitizeSchedulerTerminalReport,
} from './terminalReport';
import { reconcileScheduledAttempt } from './storeAttemptRecovery';
import { settleScheduledRunFailure, settleScheduledRunSuccess } from './storeAttemptSettlement';
import type { SchedulerState } from './storeTypes';

export const useSchedulerStore = create<SchedulerState>()(
  persist(
    (set, get) => ({
      jobs: [],
      terminalReports: [],

      addJob: (params) => {
        const id = generateId();
        const now = Date.now();
        const scheduleRuntime = prepareScheduleRuntime(params.schedule, now);
        const job: CronJob = {
          id,
          definitionRevision: 1,
          name: params.name,
          enabled: true,
          createdAtMs: now,
          updatedAtMs: now,
          schedule: scheduleRuntime.schedule,
          sessionTarget: params.sessionTarget || 'isolated',
          wakeMode: params.wakeMode || 'new',
          payload: {
            prompt: params.prompt,
            mode: params.mode ?? 'agentic',
            model: params.model,
            providerId: params.providerId,
          },
          delivery: {
            mode: params.deliveryMode || 'both',
          },
          failureAlert: params.failureAlert,
          nextRunAtMs: scheduleRuntime.nextRunAtMs,
          retryAttempts: 0,
          wakePolicy: 'notify_only',
        };
        set((state) => ({ jobs: [...state.jobs, job] }));
        return id;
      },

      updateJob: (id, updates) =>
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (job.id !== id) return job;
            const now = Date.now();
            const scheduleChanged =
              updates.schedule !== undefined && !haveSameFlatFields(job.schedule, updates.schedule);
            const payloadChanged =
              updates.payload !== undefined && !haveSameFlatFields(job.payload, updates.payload);
            const enabledChanged = updates.enabled !== undefined && updates.enabled !== job.enabled;
            const executionDefinitionChanged = scheduleChanged || payloadChanged || enabledChanged;
            const nameChanged = updates.name !== undefined && updates.name !== job.name;
            const scheduleRuntime =
              scheduleChanged || (enabledChanged && updates.enabled === true)
                ? prepareScheduleRuntime(updates.schedule ?? job.schedule, now)
                : undefined;
            const updated: CronJob = {
              ...job,
              ...updates,
              ...(scheduleRuntime
                ? {
                    schedule: scheduleRuntime.schedule,
                    nextRunAtMs: scheduleRuntime.nextRunAtMs,
                  }
                : {}),
              ...(nameChanged ? { pendingWakeNotificationRunAtMs: undefined } : {}),
              updatedAtMs: now,
              definitionRevision: executionDefinitionChanged
                ? job.definitionRevision + 1
                : job.definitionRevision,
            };
            if (!executionDefinitionChanged) return updated;
            return clearRetryState({
              ...updated,
              lastError: undefined,
              lastDeliveryError: undefined,
              lastDeliveryFailureAtMs: undefined,
            });
          }),
        })),

      removeJob: (id) => {
        let removed = false;
        set((state) => {
          const job = state.jobs.find((candidate) => candidate.id === id);
          if (!job || job.runningAttemptId) return state;
          removed = true;
          return {
            jobs: state.jobs.filter((candidate) => candidate.id !== id),
            terminalReports: state.terminalReports.filter((report) => report.jobId !== id),
          };
        });
        return removed;
      },

      enableJob: (id) => {
        const currentJob = get().jobs.find((job) => job.id === id);
        if (!currentJob || currentJob.enabled) return;
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (job.id !== id || job.enabled) return job;
            const now = Date.now();
            const scheduleRuntime = prepareScheduleRuntime(job.schedule, now);
            return clearRetryState({
              ...job,
              enabled: true,
              updatedAtMs: now,
              definitionRevision: job.definitionRevision + 1,
              schedule: scheduleRuntime.schedule,
              nextRunAtMs: scheduleRuntime.nextRunAtMs,
              lastError: undefined,
              lastDeliveryError: undefined,
              lastDeliveryFailureAtMs: undefined,
            });
          }),
        }));
      },

      disableJob: (id) => {
        const currentJob = get().jobs.find((job) => job.id === id);
        if (!currentJob || !currentJob.enabled) return;
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === id && job.enabled
              ? clearRetryState({
                  ...job,
                  enabled: false,
                  updatedAtMs: Date.now(),
                  definitionRevision: job.definitionRevision + 1,
                })
              : job,
          ),
        }));
      },

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
            runningDefinitionRevision: currentJob.definitionRevision,
            runningAttemptNumber: attempt,
            runningConversationId: undefined,
            runningEffectRisk: currentJob.payload.prompt.trim().startsWith('/') ? 'unsafe' : 'safe',
            runningOccurrenceId: currentJob.retryOccurrenceId ?? attemptId,
            runningCompletion: undefined,
            updatedAtMs: Date.now(),
          };
          const jobs = [...state.jobs];
          jobs[jobIndex] = claimedJob;
          claimed = { job: claimedJob, attempt };
          return { jobs };
        });
        return claimed;
      },

      recordRunningAttemptConversation: ({ id, attemptId, conversationId }) => {
        let recorded = false;
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (job.id !== id || job.runningAttemptId !== attemptId) return job;
            recorded = true;
            return {
              ...job,
              runningConversationId: conversationId,
              updatedAtMs: Date.now(),
            };
          }),
        }));
        return recorded;
      },

      markRunningAttemptEffectUnsafe: (id, attemptId) => {
        let marked = false;
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (job.id !== id || job.runningAttemptId !== attemptId) return job;
            if (job.runningEffectRisk === 'unsafe') {
              marked = true;
              return job;
            }
            marked = true;
            return { ...job, runningEffectRisk: 'unsafe', updatedAtMs: Date.now() };
          }),
        }));
        return marked;
      },

      restoreRunningAttemptEffectRisk: (id, attemptId, effectRisk) => {
        let restored = false;
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (job.id !== id || job.runningAttemptId !== attemptId) return job;
            restored = true;
            return { ...job, runningEffectRisk: effectRisk, updatedAtMs: Date.now() };
          }),
        }));
        return restored;
      },

      recordRunningAttemptCompletion: ({ id, attemptId, completion }) => {
        const normalized = normalizeRunningCompletion(completion);
        if (!normalized) return false;
        let recorded = false;
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (job.id !== id || job.runningAttemptId !== attemptId) return job;
            recorded = true;
            return { ...job, runningCompletion: normalized, updatedAtMs: Date.now() };
          }),
        }));
        return recorded;
      },

      reconcileStrandedAttempts: (timestamp) => {
        const reconciled: CronJob[] = [];
        set((state) => {
          let terminalReports = state.terminalReports;
          const jobs = state.jobs.map((job) => {
            if (!job.runningAttemptId) return job;
            const { job: nextJob, report } = reconcileScheduledAttempt(job, timestamp);
            reconciled.push(nextJob);
            if (report) terminalReports = appendTerminalReport(terminalReports, report);
            return nextJob;
          });
          return { jobs, terminalReports };
        });
        return reconciled;
      },

      reconcileStrandedAttempt: (id, attemptId, timestamp) => {
        let reconciled: CronJob | undefined;
        set((state) => {
          let terminalReports = state.terminalReports;
          const jobs = state.jobs.map((job) => {
            if (job.id !== id || job.runningAttemptId !== attemptId) return job;
            const outcome = reconcileScheduledAttempt(job, timestamp);
            reconciled = outcome.job;
            const { report } = outcome;
            if (report) terminalReports = appendTerminalReport(terminalReports, report);
            return reconciled;
          });
          return { jobs, terminalReports };
        });
        return reconciled;
      },

      requestPersistence: () => set((state) => ({ jobs: [...state.jobs] })),

      releaseJobAttemptClaim: ({ id, attemptId, timestamp, error, report }) => {
        let released = false;
        set((state) => {
          const jobs = state.jobs.map((job) => {
            if (job.id !== id || job.runningAttemptId !== attemptId) return job;
            released = true;
            return {
              ...job,
              updatedAtMs: Date.now(),
              lastAttemptAtMs: timestamp,
              lastFailureAtMs: timestamp,
              lastError: error,
              runningAttemptId: undefined,
              runningStartedAtMs: undefined,
              runningDefinitionRevision: undefined,
              runningAttemptNumber: undefined,
              runningConversationId: undefined,
              runningEffectRisk: undefined,
              runningOccurrenceId: undefined,
              runningCompletion: undefined,
            };
          });
          return released
            ? { jobs, terminalReports: appendTerminalReport(state.terminalReports, report) }
            : state;
        });
        return released;
      },

      recordRun: (id, attemptId, definitionRevision, timestamp, report) => {
        let recorded = false;
        set((state) => {
          const jobs = state.jobs.map((j) => {
            if (j.id !== id || j.runningAttemptId !== attemptId) return j;
            recorded = true;
            return settleScheduledRunSuccess(j, attemptId, definitionRevision, timestamp);
          });
          return recorded
            ? { jobs, terminalReports: appendTerminalReport(state.terminalReports, report) }
            : state;
        });
        return recorded;
      },

      recordRunFailure: (id, attemptId, definitionRevision, update, report) => {
        let recorded = false;
        set((state) => {
          const jobs = state.jobs.map((j) => {
            if (j.id !== id || j.runningAttemptId !== attemptId) return j;
            recorded = true;
            return settleScheduledRunFailure(j, attemptId, definitionRevision, update, report);
          });
          return recorded
            ? { jobs, terminalReports: appendTerminalReport(state.terminalReports, report) }
            : state;
        });
        return recorded;
      },

      recordRunDeferral: (id, attemptId, definitionRevision, timestamp, error, report) => {
        let recorded = false;
        let stageReport = false;
        set((state) => {
          const jobs = state.jobs.map((job) => {
            if (
              job.id !== id ||
              job.runningAttemptId !== attemptId ||
              job.runningDefinitionRevision !== definitionRevision
            ) {
              return job;
            }
            recorded = true;
            stageReport = canRetrySafelyInterruptedAttempt(job);
            const deferred = deferSafelyInterruptedAttempt(job, timestamp);
            return stageReport
              ? { ...deferred, lastError: sanitizeSchedulerReportText(error) }
              : deferred;
          });
          return recorded
            ? {
                jobs,
                terminalReports: stageReport
                  ? appendTerminalReport(state.terminalReports, report)
                  : state.terminalReports,
              }
            : state;
        });
        return recorded;
      },

      acknowledgeTerminalReport: ({ reportId, clearDeliveryFailure }) => {
        let acknowledged = false;
        set((state) => {
          if (!state.terminalReports.some((report) => report.id === reportId)) return state;
          acknowledged = true;
          return {
            jobs: clearDeliveryFailure
              ? state.jobs.map((job) =>
                  job.lastSettledAttemptId === reportId
                    ? {
                        ...job,
                        lastDeliveryError: undefined,
                        lastDeliveryFailureAtMs: undefined,
                        updatedAtMs: Date.now(),
                      }
                    : job,
                )
              : state.jobs,
            terminalReports: state.terminalReports.filter((report) => report.id !== reportId),
          };
        });
        return acknowledged;
      },

      restoreTerminalReport: (report) =>
        set((state) => ({
          terminalReports: appendTerminalReport(state.terminalReports, report),
        })),

      recordTerminalReportDeliveryFailure: ({ id, attemptId, timestamp, error }) => {
        let jobRecorded = false;
        let reportRecorded = false;
        set((state) => {
          const sanitizedError = sanitizeSchedulerReportText(error);
          const jobs = state.jobs.map((job) => {
            if (job.id !== id || job.lastSettledAttemptId !== attemptId) return job;
            jobRecorded = true;
            return {
              ...job,
              updatedAtMs: Date.now(),
              lastDeliveryError: sanitizedError,
              lastDeliveryFailureAtMs: timestamp,
            };
          });
          const terminalReports = state.terminalReports.map((report) => {
            if (report.id !== attemptId || report.jobId !== id) return report;
            reportRecorded = true;
            return sanitizeSchedulerTerminalReport({
              ...report,
              deliveryWarnings: Array.from(
                new Set([...(report.deliveryWarnings ?? []), sanitizedError]),
              ),
            });
          });
          return {
            jobs,
            terminalReports,
          };
        });
        return { jobRecorded, reportRecorded };
      },

      restoreJobAttemptClaim: ({
        id,
        attemptId,
        startedAtMs,
        definitionRevision,
        attempt,
        error,
        conversationId,
        effectRisk,
        occurrenceId,
        completion,
        claimSnapshot,
      }) =>
        set((state) => {
          const report = state.terminalReports.find((candidate) => candidate.id === attemptId);
          return {
            jobs: state.jobs.map((job) =>
              job.id === id && !job.runningAttemptId
                ? claimSnapshot
                  ? {
                      ...claimSnapshot,
                      runningCompletion:
                        normalizeRunningCompletion(completion) ??
                        normalizeRunningCompletion(claimSnapshot.runningCompletion),
                      ...(error ? { lastError: error } : {}),
                      updatedAtMs: Date.now(),
                    }
                  : {
                      ...job,
                      runningAttemptId: attemptId,
                      runningStartedAtMs: startedAtMs,
                      runningDefinitionRevision: definitionRevision,
                      runningAttemptNumber: attempt,
                      runningConversationId:
                        conversationId ??
                        (report?.conversationDurable !== false
                          ? report?.conversationId
                          : undefined),
                      runningEffectRisk: effectRisk ?? 'unsafe',
                      runningOccurrenceId: occurrenceId ?? job.retryOccurrenceId ?? attemptId,
                      runningCompletion:
                        normalizeRunningCompletion(completion) ??
                        (report?.status === 'success'
                          ? normalizeRunningCompletion({
                              completedAtMs: report.completedAtMs,
                              output: report.output ?? '',
                              conversationId: report.conversationId,
                              conversationDurable: report.conversationDurable,
                              warnings: report.warnings,
                            })
                          : undefined),
                      ...(error ? { lastError: error } : {}),
                      updatedAtMs: Date.now(),
                    }
                : job,
            ),
            terminalReports: state.terminalReports.filter(
              (candidate) => candidate.id !== attemptId,
            ),
          };
        }),

      resetJobRetry: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  updatedAtMs: Date.now(),
                  retryAttempts: 0,
                  nextRetryAtMs: undefined,
                  retryConversationId: undefined,
                  retryOccurrenceId: undefined,
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

      getJob: (id) => get().jobs.find((j) => j.id === id),
      getEnabledJobs: () => get().jobs.filter((j) => j.enabled),
    }),
    {
      name: SCHEDULER_STORE_KEY,
      storage: createJSONStorage(() => schedulerStateStorage),
      version: 7,
      migrate: (persistedState: any, version) => {
        if (!persistedState) return persistedState;
        let jobs = Array.isArray(persistedState.jobs) ? persistedState.jobs : [];
        if (version < 2) {
          jobs = jobs.map((job: CronJob) => ({
            ...job,
            delivery: {
              ...job.delivery,
              mode:
                job.delivery?.mode === 'notification' || job.delivery?.mode === 'both'
                  ? job.delivery.mode
                  : 'both',
            },
          }));
        }
        const migratedState = { ...persistedState };
        delete migratedState.lastEvaluationAtMs;
        const now = Date.now();
        const normalizedJobs = jobs.map((job: CronJob) => normalizePersistedJob(job, now));
        let terminalReports =
          version < 6 ? [] : normalizeTerminalReports(persistedState.terminalReports);
        if (version === 6) {
          for (let index = 0; index < normalizedJobs.length; index += 1) {
            const originalJob = jobs[index] as CronJob & {
              lastAmbiguousReportedAttemptId?: string;
            };
            const normalizedJob = normalizedJobs[index];
            if (
              !normalizedJob.lastAmbiguousAttemptId ||
              originalJob.lastAmbiguousReportedAttemptId === normalizedJob.lastAmbiguousAttemptId
            ) {
              continue;
            }
            const report = buildReconciledAttemptTerminalReport(
              normalizedJob,
              normalizedJob.lastAmbiguousAtMs ?? now,
            );
            if (report) terminalReports = appendTerminalReport(terminalReports, report);
          }
        }
        return {
          ...migratedState,
          terminalReports,
          jobs: normalizedJobs,
        };
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SchedulerState> | undefined;
        const now = Date.now();
        return {
          ...currentState,
          ...persisted,
          terminalReports: normalizeTerminalReports(persisted?.terminalReports),
          jobs: Array.isArray(persisted?.jobs)
            ? persisted.jobs.map((job) => normalizePersistedJob(job, now))
            : [],
        };
      },
    },
  ),
);
