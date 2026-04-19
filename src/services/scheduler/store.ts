// ---------------------------------------------------------------------------
// Kavi — Scheduler Store (Zustand)
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../../utils/id';
import type {
  CronJob,
  CronSchedule,
  CronPayload,
  CronDelivery,
  SessionTarget,
  WakeMode,
} from '../cron/types';

interface SchedulerState {
  jobs: CronJob[];

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
  recordRun: (id: string, timestamp: number) => void;
  getJob: (id: string) => CronJob | undefined;
  getEnabledJobs: () => CronJob[];
}

export const useSchedulerStore = create<SchedulerState>()(
  persist(
    (set, get) => ({
      jobs: [],

      addJob: (params) => {
        const id = generateId();
        const now = Date.now();
        const job: CronJob = {
          id,
          name: params.name,
          enabled: true,
          createdAtMs: now,
          updatedAtMs: now,
          schedule: params.schedule,
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
        };
        set((state) => ({ jobs: [...state.jobs, job] }));
        return id;
      },

      updateJob: (id, updates) =>
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id ? { ...j, ...updates, updatedAtMs: Date.now() } : j,
          ),
        })),

      removeJob: (id) => set((state) => ({ jobs: state.jobs.filter((j) => j.id !== id) })),

      enableJob: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id ? { ...j, enabled: true, updatedAtMs: Date.now() } : j,
          ),
        })),

      disableJob: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id ? { ...j, enabled: false, updatedAtMs: Date.now() } : j,
          ),
        })),

      recordRun: (id, timestamp) =>
        set((state) => ({
          jobs: state.jobs.map((j) => {
            if (j.id !== id) return j;
            const updated: CronJob = { ...j, updatedAtMs: Date.now() };
            // For 'at' schedule, auto-disable after run
            if (j.schedule.kind === 'at' || j.deleteAfterRun) {
              return { ...updated, enabled: false };
            }
            return updated;
          }),
        })),

      getJob: (id) => get().jobs.find((j) => j.id === id),
      getEnabledJobs: () => get().jobs.filter((j) => j.enabled),
    }),
    {
      name: 'kavi-scheduler',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persistedState: any, version) => {
        if (!persistedState) return persistedState;
        if (version < 2) {
          return {
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
        return persistedState;
      },
    },
  ),
);
