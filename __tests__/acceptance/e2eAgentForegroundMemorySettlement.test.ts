jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  drainIngestionQueueWithWakeup,
  getIngestionJob,
  type IngestionJob,
} from '../../src/services/memory/ingestionQueue';
import { settleForegroundScenarioMemory } from '../../src/acceptance/e2eAgent/foregroundScenarioDriverRuntime';

jest.mock('../../src/services/memory/ingestionQueue', () => ({
  drainIngestionQueueWithWakeup: jest.fn(async () => ({
    attempted: 0,
    completed: 0,
    completedStructural: 0,
    completedEnriched: 0,
    retrying: 0,
    degraded: 0,
    deferred: 0,
    resourceDeferred: 0,
    failed: 0,
  })),
  getIngestionJob: jest.fn(),
}));
jest.mock('../../src/services/memory/lifecycle', () => ({
  loadIngestionJobRuntimeContext: jest.fn(() => ({})),
}));
jest.mock('../../src/services/memory/ingestionReceiptStore', () => ({
  listIngestionPersistenceReceipts: jest.fn(() => []),
}));

const mockedGetIngestionJob = jest.mocked(getIngestionJob);
const mockedDrainIngestionQueueWithWakeup = jest.mocked(drainIngestionQueueWithWakeup);

function makeJob(status: IngestionJob['status']): IngestionJob {
  return {
    id: 'job-processing',
    threadId: 'conversation',
    threadTitle: 'Conversation',
    memoryConversationId: 'conversation',
    taskId: null,
    sourceRunId: null,
    chatProviderId: null,
    chatModel: null,
    sourceStartMessageId: null,
    sourceEndMessageId: 'assistant-message',
    sourceAt: 1,
    reason: 'turn_completed',
    status,
    attemptCount: 1,
    providerEnrichment: true,
    providerOutcome: null,
    outcomeCode: null,
    nextAttemptAt: null,
    leaseExpiresAt: null,
    claimToken: null,
    structuralCompletedAt: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
  };
}

describe('foreground scenario memory settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('counts idempotent publications of the same durable job once', async () => {
    const completed = {
      ...makeJob('completed_enriched'),
      providerOutcome: 'valid' as const,
      structuralCompletedAt: 2,
      completedAt: 2,
    };
    const publication = {
      disposition: 'enqueued' as const,
      jobId: completed.id,
    };
    mockedGetIngestionJob.mockReturnValue(completed);

    await expect(
      settleForegroundScenarioMemory(
        [{ promise: Promise.resolve(publication) }, { promise: Promise.resolve(publication) }],
        1_000,
      ),
    ).resolves.toEqual([expect.objectContaining({ publication, job: completed })]);
    expect(mockedGetIngestionJob).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight drain after the foreground drain loses the ingestion slot', async () => {
    jest.useFakeTimers();
    const pending = makeJob('pending');
    const processing = makeJob('processing');
    const completed = {
      ...makeJob('completed_structural'),
      providerOutcome: 'structural_only' as const,
      structuralCompletedAt: 2,
      completedAt: 2,
    };
    mockedGetIngestionJob
      .mockImplementationOnce(() => pending)
      .mockImplementationOnce(() => processing)
      .mockReturnValue(completed);
    mockedDrainIngestionQueueWithWakeup.mockResolvedValueOnce({
      attempted: 1,
      completed: 0,
      completedStructural: 0,
      completedEnriched: 0,
      retrying: 0,
      degraded: 0,
      deferred: 1,
      resourceDeferred: 1,
      failed: 0,
    });

    try {
      const settlement = settleForegroundScenarioMemory(
        [
          {
            promise: Promise.resolve({
              disposition: 'enqueued',
              jobId: pending.id,
            }),
          },
        ],
        1_000,
      );
      await jest.advanceTimersByTimeAsync(10);

      await expect(settlement).resolves.toEqual([expect.objectContaining({ job: completed })]);
      expect(mockedDrainIngestionQueueWithWakeup).toHaveBeenCalledTimes(1);
      expect(mockedDrainIngestionQueueWithWakeup).toHaveBeenCalledWith(
        expect.objectContaining({ maxJobs: 1 }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses bounded backoff and requests at most one drain while awaiting memory', async () => {
    jest.useFakeTimers();
    mockedGetIngestionJob
      .mockImplementationOnce(() => makeJob('pending'))
      .mockReturnValue(makeJob('processing'));
    try {
      const settlement = settleForegroundScenarioMemory(
        [
          {
            promise: Promise.resolve({
              disposition: 'enqueued',
              jobId: 'job-processing',
            }),
          },
        ],
        1_000,
      );
      const rejection = expect(settlement).rejects.toThrow(
        'Timed out waiting for memory ingestion job job-processing.',
      );
      await jest.advanceTimersByTimeAsync(1_000);
      await rejection;

      expect(mockedGetIngestionJob.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockedGetIngestionJob.mock.calls.length).toBeLessThanOrEqual(10);
      expect(mockedDrainIngestionQueueWithWakeup).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['pending', 'processing', 'retrying'] as const)(
    'accepts a durable structural checkpoint while enrichment is %s',
    async (status) => {
      const checkpointed = {
        ...makeJob(status),
        structuralCompletedAt: 2,
      };
      mockedGetIngestionJob.mockReturnValue(checkpointed);

      await expect(
        settleForegroundScenarioMemory(
          [
            {
              promise: Promise.resolve({
                disposition: 'enqueued',
                jobId: checkpointed.id,
              }),
            },
          ],
          1_000,
        ),
      ).resolves.toEqual([expect.objectContaining({ job: checkpointed })]);
      expect(mockedDrainIngestionQueueWithWakeup).not.toHaveBeenCalled();
    },
  );

  it('does not accept uncheckpointed retry work as settled memory', async () => {
    jest.useFakeTimers();
    mockedGetIngestionJob.mockReturnValue({
      ...makeJob('retrying'),
      nextAttemptAt: 2_000,
    });
    try {
      const settlement = settleForegroundScenarioMemory(
        [
          {
            promise: Promise.resolve({
              disposition: 'enqueued',
              jobId: 'job-processing',
            }),
          },
        ],
        1_000,
      );
      const rejection = expect(settlement).rejects.toThrow(
        'Timed out waiting for memory ingestion job job-processing.',
      );
      await jest.advanceTimersByTimeAsync(1_000);
      await rejection;

      expect(mockedDrainIngestionQueueWithWakeup).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
