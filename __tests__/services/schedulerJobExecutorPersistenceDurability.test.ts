const mockFlushSchedulerStorePersistenceNow = jest.fn();

jest.mock('../../src/services/scheduler/persistence', () => ({
  ...jest.requireActual('../../src/services/scheduler/persistence'),
  flushSchedulerStorePersistenceNow: (...args: unknown[]) =>
    mockFlushSchedulerStorePersistenceNow(...args),
}));

import { useSchedulerStore } from '../../src/services/scheduler/store';
import {
  checkpointScheduledAttemptCompletion,
  markScheduledAttemptEffectUnsafe,
} from '../../src/services/scheduler/jobExecutorPersistence';
import { settleSafeBackgroundAbort } from '../../src/services/scheduler/backgroundAbortSettlement';
import { SchedulerAppBackgroundAbortError } from '../../src/services/scheduler/executionError';

function claimJob() {
  const store = useSchedulerStore.getState();
  const id = store.addJob({
    name: 'Durability fence',
    schedule: { kind: 'every', everyMs: 60_000 },
    prompt: 'Run safely',
  });
  const claim = store.tryClaimJobAttempt({
    id,
    attemptId: 'attempt-1',
    timestamp: 100,
    force: true,
  });
  if (!claim) throw new Error('Expected claim');
  return claim.job;
}

describe('scheduled attempt persistence fences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSchedulerStore.setState({ jobs: [], terminalReports: [] });
  });

  it('restores the safe in-memory claim when the pre-effect fence cannot persist', async () => {
    const job = claimJob();
    mockFlushSchedulerStorePersistenceNow
      .mockRejectedValueOnce(new Error('unsafe fence write failed'))
      .mockResolvedValueOnce(undefined);

    await expect(markScheduledAttemptEffectUnsafe(job)).rejects.toThrow(
      'unsafe fence write failed',
    );

    expect(useSchedulerStore.getState().getJob(job.id)).toMatchObject({
      runningAttemptId: 'attempt-1',
      runningEffectRisk: 'safe',
    });
    expect(mockFlushSchedulerStorePersistenceNow).toHaveBeenCalledTimes(2);
  });

  it('retains an in-memory completion proof when its checkpoint write fails', async () => {
    const job = claimJob();
    mockFlushSchedulerStorePersistenceNow.mockRejectedValueOnce(
      new Error('completion write failed'),
    );

    await expect(
      checkpointScheduledAttemptCompletion(job, {
        output: 'Completed answer',
        conversationId: 'conversation-1',
      }),
    ).rejects.toMatchObject({ name: 'SchedulerCompletionCheckpointError' });

    expect(useSchedulerStore.getState().getJob(job.id)?.runningCompletion).toMatchObject({
      output: 'Completed answer',
      conversationId: 'conversation-1',
    });
  });

  it('restores the exact safe claim when background deferral cannot persist', async () => {
    const job = claimJob();
    useSchedulerStore.getState().recordRunningAttemptConversation({
      id: job.id,
      attemptId: job.runningAttemptId!,
      conversationId: 'conversation-1',
    });
    const claimed = useSchedulerStore.getState().getJob(job.id)!;
    mockFlushSchedulerStorePersistenceNow.mockRejectedValueOnce(new Error('deferral write failed'));

    await expect(
      settleSafeBackgroundAbort({
        store: useSchedulerStore.getState(),
        job: claimed,
        attemptId: claimed.runningAttemptId!,
        attempt: 1,
        startedAtMs: 100,
        claimedAtMs: 100,
        completedAtMs: 200,
        trigger: 'scheduled',
        error: 'backgrounded',
        executionError: new SchedulerAppBackgroundAbortError(new Error('backgrounded')),
        maxRetries: 3,
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(useSchedulerStore.getState().getJob(job.id)).toMatchObject({
      runningAttemptId: 'attempt-1',
      runningConversationId: 'conversation-1',
      runningEffectRisk: 'safe',
      runningOccurrenceId: 'attempt-1',
    });
  });

  it('clears a prior retry occurrence when an unsafe retry is terminalized', () => {
    const job = claimJob();
    useSchedulerStore.setState((state) => ({
      jobs: state.jobs.map((candidate) =>
        candidate.id === job.id
          ? { ...candidate, retryOccurrenceId: 'older-occurrence' }
          : candidate,
      ),
    }));
    useSchedulerStore.getState().markRunningAttemptEffectUnsafe(job.id, job.runningAttemptId!);

    useSchedulerStore.getState().reconcileStrandedAttempt(job.id, job.runningAttemptId!, 200);

    expect(useSchedulerStore.getState().getJob(job.id)?.retryOccurrenceId).toBeUndefined();
  });
});
