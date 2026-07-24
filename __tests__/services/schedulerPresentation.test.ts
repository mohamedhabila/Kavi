import {
  buildSchedulerJobPresentation,
  selectLatestSchedulerTrace,
} from '../../src/services/scheduler/presentation';
import type { CronJob } from '../../src/services/cron/types';
import type { ExecutionTrace } from '../../src/services/scheduler/traceStore';

const baseJob: CronJob = {
  id: 'job-1',
  definitionRevision: 1,
  name: 'Morning briefing',
  enabled: true,
  createdAtMs: 1,
  updatedAtMs: 2,
  schedule: { kind: 'every', everyMs: 86_400_000 },
  sessionTarget: 'isolated',
  wakeMode: 'new',
  payload: { prompt: 'Summarize the day', mode: 'agentic' },
  nextRunAtMs: 1_000,
};

function trace(overrides: Partial<ExecutionTrace>): ExecutionTrace {
  return {
    id: 'trace-1',
    jobId: 'job-1',
    jobName: 'Morning briefing',
    startedAt: 5,
    completedAt: 10,
    durationMs: 5,
    status: 'success',
    trigger: 'scheduled',
    ...overrides,
  };
}

describe('scheduler presentation', () => {
  it.each([
    [{ enabled: false }, 'paused'],
    [{ runningAttemptId: 'attempt-1' }, 'running'],
    [{ enabled: false, runningAttemptId: 'attempt-1' }, 'running'],
    [{ nextRetryAtMs: 900 }, 'retrying'],
    [{ lastFailureAtMs: 800, lastSuccessAtMs: 700 }, 'needs-attention'],
    [{ lastError: 'Network unavailable' }, 'needs-attention'],
    [{}, 'scheduled'],
  ] as const)('derives the canonical job state from %p', (overrides, expected) => {
    expect(buildSchedulerJobPresentation({ ...baseJob, ...overrides }, []).state).toBe(expected);
  });

  it('uses the latest trace as the durable result', () => {
    const traces = [
      trace({ id: 'trace-old', completedAt: 10, status: 'success' }),
      trace({
        id: 'trace-new',
        completedAt: 20,
        status: 'error',
        error: 'Provider unavailable',
      }),
    ];

    expect(selectLatestSchedulerTrace(traces, baseJob.id)?.id).toBe('trace-new');
    expect(buildSchedulerJobPresentation(baseJob, traces).latestResult).toEqual({
      status: 'failed',
      timestamp: 20,
      detail: 'Provider unavailable',
    });
  });

  it('falls back to persisted job settlement when trace hydration is unavailable', () => {
    expect(
      buildSchedulerJobPresentation(
        {
          ...baseJob,
          lastSuccessAtMs: 100,
          lastFailureAtMs: 200,
          nextRetryAtMs: 300,
          lastError: 'Retry later',
          lastWakeError: 'Notification permission denied',
        },
        [],
      ),
    ).toEqual({
      state: 'retrying',
      nextOccurrenceAt: 300,
      latestResult: { status: 'retrying', timestamp: 200, detail: 'Retry later' },
      hasNotificationIssue: true,
    });
  });
});
