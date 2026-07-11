import { useSchedulerStore } from '../../src/services/scheduler/store';

jest.mock('../../src/services/cron/schedule', () => ({
  computeNextRunAtMs: jest.fn((schedule: any, referenceMs: number) =>
    schedule.kind === 'at' ? schedule.atMs : referenceMs + 60_000,
  ),
}));

function addJob(name: string, schedule: any = { kind: 'every', everyMs: 60_000 }): string {
  return useSchedulerStore.getState().addJob({
    name,
    schedule,
    prompt: `Run ${name}`,
  });
}

describe('scheduler store durability', () => {
  beforeEach(() => {
    useSchedulerStore.setState({ jobs: [], lastEvaluationAtMs: undefined });
  });

  it('persists non-default failure alert policy', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Policy Job',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'Run policy job',
      failureAlert: { enabled: true, maxRetries: 4 },
    });

    expect(useSchedulerStore.getState().getJob(id)?.failureAlert).toEqual({
      enabled: true,
      maxRetries: 4,
    });
  });

  it('allows exactly one atomic claim for a due occurrence', () => {
    const id = addJob('Claim Job');
    const now = Date.now() + 60_000;
    const first = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-1',
      timestamp: now,
      force: true,
    });
    const second = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-2',
      timestamp: now,
      force: true,
    });

    expect(first).toMatchObject({ attempt: 1, job: { runningAttemptId: 'attempt-1' } });
    expect(second).toBeUndefined();
  });

  it('preserves an active claim across edits and rejects removal', () => {
    const id = addJob('Active Job');
    useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-active',
      timestamp: Date.now(),
      force: true,
    });

    useSchedulerStore.getState().disableJob(id);
    useSchedulerStore.getState().updateJob(id, { name: 'Renamed Active Job' });
    useSchedulerStore.getState().resetJobRetry(id);

    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      enabled: false,
      name: 'Renamed Active Job',
      runningAttemptId: 'attempt-active',
    });
    expect(useSchedulerStore.getState().removeJob(id)).toBe(false);
  });

  it('settles only the attempt that owns the claim', () => {
    const id = addJob('CAS Job');
    useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-owner',
      timestamp: Date.now(),
      force: true,
    });

    expect(useSchedulerStore.getState().recordRun(id, 'attempt-stale', Date.now())).toBe(false);
    expect(useSchedulerStore.getState().getJob(id)?.runningAttemptId).toBe('attempt-owner');
    expect(useSchedulerStore.getState().recordRun(id, 'attempt-owner', Date.now())).toBe(true);
    expect(useSchedulerStore.getState().getJob(id)?.runningAttemptId).toBeUndefined();
  });

  it('terminalizes stranded recurring and one-shot claims without replay', () => {
    const recurringId = addJob('Recurring');
    const oneShotId = addJob('One Shot', { kind: 'at', atMs: Date.now() + 1_000 });
    useSchedulerStore.setState((state) => ({
      jobs: state.jobs.map((job) => ({
        ...job,
        runningAttemptId: `attempt-${job.id}`,
        runningStartedAtMs: 100,
      })),
    }));
    const now = Date.now() + 5_000;

    const reconciled = useSchedulerStore.getState().reconcileStrandedAttempts(now);

    expect(reconciled).toHaveLength(2);
    expect(useSchedulerStore.getState().getJob(recurringId)).toMatchObject({
      enabled: true,
      lastAmbiguousAttemptId: `attempt-${recurringId}`,
      lastAmbiguousAtMs: now,
      runningAttemptId: undefined,
    });
    expect(useSchedulerStore.getState().getJob(oneShotId)).toMatchObject({
      enabled: false,
      lastAmbiguousAttemptId: `attempt-${oneShotId}`,
      nextRunAtMs: undefined,
    });
  });
});
