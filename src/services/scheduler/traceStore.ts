// ---------------------------------------------------------------------------
// Kavi — Execution Trace Store (Zustand)
// ---------------------------------------------------------------------------
// Records execution traces for scheduled jobs. Provides queryable history
// for debugging, reliability dashboards, and alerting.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ExecutionTrace {
  id: string;
  jobId: string;
  jobName: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  status: 'success' | 'error' | 'retrying' | 'skipped';
  output?: string;
  error?: string;
  attempt?: number;
  trigger: 'scheduled' | 'manual' | 'missed-recovery' | 'background-fetch';
}

interface ExecutionTraceState {
  traces: ExecutionTrace[];
  addTrace: (trace: ExecutionTrace) => void;
  clearTraces: () => void;
  clearTracesForJob: (jobId: string) => void;

  // Queries
  getTracesForJob: (jobId: string, limit?: number) => ExecutionTrace[];
  getRecentTraces: (limit?: number) => ExecutionTrace[];
  getFailureRate: (jobId: string, windowMs?: number) => number;
  getAverageDuration: (jobId: string, windowMs?: number) => number;
}

const MAX_TRACES = 500;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const useExecutionTraceStore = create<ExecutionTraceState>()(
  persist(
    (set, get) => ({
      traces: [],

      addTrace: (trace) =>
        set((state) => ({
          traces: [trace, ...state.traces].slice(0, MAX_TRACES),
        })),

      clearTraces: () => set({ traces: [] }),

      clearTracesForJob: (jobId) =>
        set((state) => ({
          traces: state.traces.filter((t) => t.jobId !== jobId),
        })),

      getTracesForJob: (jobId, limit = 50) =>
        get()
          .traces.filter((t) => t.jobId === jobId)
          .slice(0, limit),

      getRecentTraces: (limit = 50) => get().traces.slice(0, limit),

      getFailureRate: (jobId, windowMs = DEFAULT_WINDOW_MS) => {
        const cutoff = Date.now() - windowMs;
        const jobTraces = get().traces.filter(
          (t) => t.jobId === jobId && t.completedAt >= cutoff && t.status !== 'retrying',
        );
        if (jobTraces.length === 0) return 0;
        const failures = jobTraces.filter((t) => t.status === 'error').length;
        return failures / jobTraces.length;
      },

      getAverageDuration: (jobId, windowMs = DEFAULT_WINDOW_MS) => {
        const cutoff = Date.now() - windowMs;
        const successTraces = get().traces.filter(
          (t) => t.jobId === jobId && t.completedAt >= cutoff && t.status === 'success',
        );
        if (successTraces.length === 0) return 0;
        const total = successTraces.reduce((sum, t) => sum + t.durationMs, 0);
        return total / successTraces.length;
      },
    }),
    {
      name: 'kavi-execution-traces',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
