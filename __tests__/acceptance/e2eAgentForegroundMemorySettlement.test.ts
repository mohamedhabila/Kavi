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
    sourceDeferred: 0,
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
      sourceDeferred: 0,
      resourceDeferred: 1,
      failed: 0,
    });

    try {
      const settlement = settleForegroundScenarioMemory(
        [
          {
            promise: Promise.resolve({
              processed: true,
              enqueued: true,
              jobId: pending.id,
              episodeId: null,
              factIds: [],
              activeFocusUpdated: false,
              openThreadsUpdated: false,
              enriched: false,
            }),
          },
        ],
        1_000,
      );
      await jest.advanceTimersByTimeAsync(10);

      await expect(settlement).resolves.toEqual([
        expect.objectContaining({ job: completed }),
      ]);
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
              processed: true,
              enqueued: true,
              jobId: 'job-processing',
              episodeId: null,
              factIds: [],
              activeFocusUpdated: false,
              openThreadsUpdated: false,
              enriched: false,
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
});
