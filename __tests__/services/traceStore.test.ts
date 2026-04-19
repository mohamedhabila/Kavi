// ---------------------------------------------------------------------------
// Tests — Execution Trace Store
// ---------------------------------------------------------------------------

import {
  useExecutionTraceStore,
  type ExecutionTrace,
} from '../../src/services/scheduler/traceStore';

const makeTrace = (overrides: Partial<ExecutionTrace> = {}): ExecutionTrace => ({
  id: `trace-${Date.now()}-${Math.random()}`,
  jobId: 'job-1',
  jobName: 'Test Job',
  startedAt: Date.now() - 1000,
  completedAt: Date.now(),
  durationMs: 1000,
  status: 'success',
  trigger: 'scheduled',
  ...overrides,
});

beforeEach(() => {
  useExecutionTraceStore.setState({ traces: [] });
});

describe('useExecutionTraceStore', () => {
  describe('addTrace', () => {
    it('adds a trace at the beginning of the array', () => {
      const store = useExecutionTraceStore.getState();
      const trace1 = makeTrace({ id: 'trace-1', jobName: 'First' });
      const trace2 = makeTrace({ id: 'trace-2', jobName: 'Second' });

      store.addTrace(trace1);
      store.addTrace(trace2);

      const traces = useExecutionTraceStore.getState().traces;
      expect(traces.length).toBe(2);
      expect(traces[0].id).toBe('trace-2');
      expect(traces[1].id).toBe('trace-1');
    });

    it('trims to MAX_TRACES (500)', () => {
      const store = useExecutionTraceStore.getState();
      for (let i = 0; i < 510; i++) {
        store.addTrace(makeTrace({ id: `trace-${i}` }));
      }
      expect(useExecutionTraceStore.getState().traces.length).toBe(500);
    });
  });

  describe('getTracesForJob', () => {
    it('returns only traces for the specified job', () => {
      const store = useExecutionTraceStore.getState();
      store.addTrace(makeTrace({ id: 't1', jobId: 'job-1' }));
      store.addTrace(makeTrace({ id: 't2', jobId: 'job-2' }));
      store.addTrace(makeTrace({ id: 't3', jobId: 'job-1' }));

      const jobTraces = useExecutionTraceStore.getState().getTracesForJob('job-1');
      expect(jobTraces.length).toBe(2);
      expect(jobTraces.every((t) => t.jobId === 'job-1')).toBe(true);
    });

    it('respects the limit parameter', () => {
      const store = useExecutionTraceStore.getState();
      for (let i = 0; i < 10; i++) {
        store.addTrace(makeTrace({ id: `t${i}`, jobId: 'job-1' }));
      }
      const limited = useExecutionTraceStore.getState().getTracesForJob('job-1', 3);
      expect(limited.length).toBe(3);
    });
  });

  describe('getRecentTraces', () => {
    it('returns traces in reverse chronological order', () => {
      const store = useExecutionTraceStore.getState();
      store.addTrace(makeTrace({ id: 't1' }));
      store.addTrace(makeTrace({ id: 't2' }));
      store.addTrace(makeTrace({ id: 't3' }));

      const recent = useExecutionTraceStore.getState().getRecentTraces(2);
      expect(recent.length).toBe(2);
      expect(recent[0].id).toBe('t3');
    });
  });

  describe('getFailureRate', () => {
    it('calculates correct failure rate', () => {
      const store = useExecutionTraceStore.getState();
      store.addTrace(makeTrace({ id: 't1', status: 'success' }));
      store.addTrace(makeTrace({ id: 't2', status: 'error' }));
      store.addTrace(makeTrace({ id: 't3', status: 'success' }));
      store.addTrace(makeTrace({ id: 't4', status: 'error' }));

      const rate = useExecutionTraceStore.getState().getFailureRate('job-1');
      expect(rate).toBeCloseTo(0.5);
    });

    it('excludes retrying traces from failure rate', () => {
      const store = useExecutionTraceStore.getState();
      store.addTrace(makeTrace({ id: 't1', status: 'success' }));
      store.addTrace(makeTrace({ id: 't2', status: 'retrying' }));

      const rate = useExecutionTraceStore.getState().getFailureRate('job-1');
      expect(rate).toBe(0); // Only 1 success, retrying excluded
    });

    it('returns 0 for no traces', () => {
      const rate = useExecutionTraceStore.getState().getFailureRate('nonexistent');
      expect(rate).toBe(0);
    });
  });

  describe('getAverageDuration', () => {
    it('calculates average of successful traces', () => {
      const store = useExecutionTraceStore.getState();
      store.addTrace(makeTrace({ id: 't1', status: 'success', durationMs: 100 }));
      store.addTrace(makeTrace({ id: 't2', status: 'success', durationMs: 300 }));
      store.addTrace(makeTrace({ id: 't3', status: 'error', durationMs: 5000 }));

      const avg = useExecutionTraceStore.getState().getAverageDuration('job-1');
      expect(avg).toBe(200);
    });

    it('returns 0 when no successful traces', () => {
      const store = useExecutionTraceStore.getState();
      store.addTrace(makeTrace({ id: 't1', status: 'error', durationMs: 100 }));

      const avg = useExecutionTraceStore.getState().getAverageDuration('job-1');
      expect(avg).toBe(0);
    });
  });

  describe('clearTracesForJob', () => {
    it('removes traces for the specified job only', () => {
      const store = useExecutionTraceStore.getState();
      store.addTrace(makeTrace({ id: 't1', jobId: 'job-1' }));
      store.addTrace(makeTrace({ id: 't2', jobId: 'job-2' }));
      store.addTrace(makeTrace({ id: 't3', jobId: 'job-1' }));

      useExecutionTraceStore.getState().clearTracesForJob('job-1');
      const remaining = useExecutionTraceStore.getState().traces;
      expect(remaining.length).toBe(1);
      expect(remaining[0].jobId).toBe('job-2');
    });
  });

  describe('clearTraces', () => {
    it('removes all traces', () => {
      const store = useExecutionTraceStore.getState();
      store.addTrace(makeTrace({ id: 't1' }));
      store.addTrace(makeTrace({ id: 't2' }));

      useExecutionTraceStore.getState().clearTraces();
      expect(useExecutionTraceStore.getState().traces.length).toBe(0);
    });
  });
});
