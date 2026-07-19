jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  drainIngestionQueueWithWakeup,
  getIngestionJob,
  type IngestionJob,
} from '../../src/services/memory/ingestionQueue';
import {
  resolveForegroundScenarioTurnRun,
  settleForegroundScenarioMemory,
  shouldExpectForegroundMemoryCloseout,
} from '../../src/acceptance/e2eAgent/foregroundScenarioDriverRuntime';
import {
  sealForegroundScenarioMemoryEvidence,
  sealForegroundScenarioMemoryEvidenceAfterProviderWait,
} from '../../src/acceptance/e2eAgent/foregroundScenarioMemoryEvidence';
import { listIngestionDurabilityReceipts } from '../../src/services/memory/ingestionStructuralReceiptStore';
import { runMemoryTransaction } from '../../src/services/memory/access/transaction';
import {
  captureCompleteMemoryEvidenceForIsolatedEvaluation,
  type ScopedMemoryEvidenceSnapshot,
} from '../../src/services/memory/evidenceSnapshot';

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
jest.mock('../../src/services/memory/ingestionStructuralReceiptStore', () => ({
  listIngestionDurabilityReceipts: jest.fn(() => []),
}));
jest.mock('../../src/services/memory/access/transaction', () => ({
  runMemoryTransaction: jest.fn((callback: () => unknown) => callback()),
}));
jest.mock('../../src/services/memory/evidenceSnapshot', () => ({
  captureCompleteMemoryEvidenceForIsolatedEvaluation: jest.fn(),
}));

const mockedGetIngestionJob = jest.mocked(getIngestionJob);
const mockedDrainIngestionQueueWithWakeup = jest.mocked(drainIngestionQueueWithWakeup);
const mockedListIngestionDurabilityReceipts = jest.mocked(listIngestionDurabilityReceipts);
const mockedRunMemoryTransaction = jest.mocked(runMemoryTransaction);
const mockedCaptureCompleteMemoryEvidence = jest.mocked(
  captureCompleteMemoryEvidenceForIsolatedEvaluation,
);

const MEMORY_SCOPE = {
  memoryConversationId: 'conversation',
  sourceThreadId: 'conversation',
} as const;

function makeEvidenceSnapshot(
  overrides: Partial<ScopedMemoryEvidenceSnapshot> = {},
): ScopedMemoryEvidenceSnapshot {
  return {
    capturedAt: 1,
    scope: MEMORY_SCOPE,
    facts: [],
    episodes: [],
    workingBlocks: [],
    ingestionJobs: [],
    ...overrides,
  };
}

function makeJob(status: IngestionJob['status']): IngestionJob {
  return {
    id: 'job-processing',
    threadId: 'conversation',
    threadTitle: 'Conversation',
    memoryConversationId: 'conversation',
    personaId: 'default',
    taskId: null,
    sourceRunId: null,
    chatProviderId: null,
    chatModel: null,
    sourceStartMessageId: null,
    sourceEndMessageId: 'assistant-message',
    sourceSnapshotVersion: 1,
    sourceSnapshotSha256: 'a'.repeat(64),
    sourceSnapshotByteLength: 1,
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
    mockedListIngestionDurabilityReceipts.mockReturnValue([]);
    mockedRunMemoryTransaction.mockImplementation((callback) => callback() as never);
    mockedCaptureCompleteMemoryEvidence.mockReturnValue(makeEvidenceSnapshot());
  });

  it('keeps a clarification checkpoint nonterminal and attributes its reply to the same run', () => {
    expect(
      shouldExpectForegroundMemoryCloseout({
        disableLongTermMemory: false,
        finalAssistantCompleted: true,
        graphStatus: 'awaiting_user',
        isSideThread: false,
        timedOut: false,
      }),
    ).toBe(false);
    const resumed = { id: 'run-awaiting-user', userMessageId: 'original-user' };
    expect(
      resolveForegroundScenarioTurnRun(
        { agentRuns: [resumed] } as never,
        'reply-user',
        new Set([resumed.id]),
        resumed.id,
      ),
    ).toBe(resumed);
    expect(() =>
      resolveForegroundScenarioTurnRun(
        { agentRuns: [resumed, { id: 'replacement-run', userMessageId: 'reply-user' }] } as never,
        'reply-user',
        new Set([resumed.id]),
        resumed.id,
      ),
    ).toThrow('created a new AgentRun instead of resuming');
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

  it('returns at structural durability while provider enrichment is still draining', async () => {
    const pending = makeJob('pending');
    const checkpointed = {
      ...makeJob('processing'),
      structuralCompletedAt: 2,
    };
    let finishDrain!: () => void;
    const draining = new Promise<Awaited<ReturnType<typeof drainIngestionQueueWithWakeup>>>(
      (resolve) => {
        finishDrain = () =>
          resolve({
            attempted: 1,
            completed: 1,
            completedStructural: 0,
            completedEnriched: 1,
            retrying: 0,
            degraded: 0,
            deferred: 0,
            resourceDeferred: 0,
            failed: 0,
          });
      },
    );
    mockedGetIngestionJob
      .mockImplementationOnce(() => pending)
      .mockReturnValue(checkpointed);
    mockedDrainIngestionQueueWithWakeup.mockReturnValueOnce(draining);

    await expect(
      settleForegroundScenarioMemory(
        [
          {
            promise: Promise.resolve({
              disposition: 'enqueued',
              jobId: pending.id,
            }),
          },
        ],
        1_000,
      ),
    ).resolves.toEqual([expect.objectContaining({ job: checkpointed })]);
    expect(mockedDrainIngestionQueueWithWakeup).toHaveBeenCalledTimes(1);
    finishDrain();
    await draining;
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

  it('captures the product structural receipt without awaiting provider enrichment', async () => {
    const checkpointed = {
      ...makeJob('processing'),
      structuralCompletedAt: 2,
    };
    const structuralReceipt = {
      phase: 'structural_checkpoint' as const,
      jobId: checkpointed.id,
      attemptNumber: 1,
      source: {
        memoryConversationId: checkpointed.memoryConversationId,
        sourceThreadId: checkpointed.threadId,
        personaId: checkpointed.personaId!,
        taskId: null,
        sourceRunId: null,
        sourceStartMessageId: null,
        sourceEndMessageId: checkpointed.sourceEndMessageId,
        sourceSnapshotSha256: checkpointed.sourceSnapshotSha256!,
        sourceAt: checkpointed.sourceAt,
      },
      episodeId: 'episode-opaque',
      deterministicFactIds: ['fact-opaque'],
      invalidatedFactIds: [],
      bridgedEvidenceFactIds: [],
      agentRunMemoryFactIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      persistedAt: 2,
    };
    mockedGetIngestionJob.mockReturnValue(checkpointed);
    mockedListIngestionDurabilityReceipts.mockReturnValue([structuralReceipt]);

    await expect(
      settleForegroundScenarioMemory(
        [
          {
            promise: Promise.resolve({ disposition: 'enqueued', jobId: checkpointed.id }),
          },
        ],
        1_000,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ job: checkpointed, receipts: [structuralReceipt] }),
    ]);
    expect(mockedDrainIngestionQueueWithWakeup).not.toHaveBeenCalled();
  });

  it('does not poll provider enrichment when no rubric requires a provider outcome', async () => {
    const checkpointed = {
      ...makeJob('processing'),
      structuralCompletedAt: 2,
    };
    mockedGetIngestionJob.mockReturnValue(checkpointed);

    await expect(
      sealForegroundScenarioMemoryEvidenceAfterProviderWait({
        memoryScope: MEMORY_SCOPE,
        turns: [
          {
            memory: [
              {
                publication: { disposition: 'enqueued', jobId: checkpointed.id },
                job: checkpointed,
                receipts: [],
              },
            ],
          } as never,
        ],
        requirements: [],
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual(expect.objectContaining({ memoryFinalState: makeEvidenceSnapshot() }));
    expect(mockedListIngestionDurabilityReceipts).toHaveBeenCalledTimes(1);
  });

  it('waits for a slow provider final only when the rubric requires its outcome', async () => {
    jest.useFakeTimers();
    const checkpointed = {
      ...makeJob('processing'),
      structuralCompletedAt: 2,
    };
    const providerFinal = {
      phase: 'provider_final' as const,
      jobId: checkpointed.id,
      attemptNumber: 1,
      episodeId: null,
      deterministicFactIds: [],
      providerFactIds: [],
      invalidatedFactIds: [],
      bridgedEvidenceFactIds: [],
      agentRunMemoryFactIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      providerOutcome: 'empty_valid' as const,
      providerOutcomeCode: null,
      persistedAt: 3,
    };
    const completed = {
      ...checkpointed,
      status: 'completed_enriched' as const,
      providerOutcome: 'empty_valid' as const,
      completedAt: 3,
    };
    let providerFinalVisible = false;
    mockedListIngestionDurabilityReceipts.mockImplementation(() =>
      providerFinalVisible ? [providerFinal] : [],
    );
    mockedGetIngestionJob.mockImplementation(() =>
      providerFinalVisible ? completed : checkpointed,
    );

    try {
      const sealing = sealForegroundScenarioMemoryEvidenceAfterProviderWait({
        memoryScope: MEMORY_SCOPE,
        turns: [
          {
            memory: [
              {
                publication: { disposition: 'enqueued', jobId: checkpointed.id },
                job: checkpointed,
                receipts: [],
              },
            ],
          } as never,
        ],
        requirements: [{ turnIndex: 0, providerOutcome: 'empty_valid' }],
        timeoutMs: 1_000,
      });
      await Promise.resolve();
      expect(mockedCaptureCompleteMemoryEvidence).not.toHaveBeenCalled();

      providerFinalVisible = true;
      await jest.advanceTimersByTimeAsync(25);

      await expect(sealing).resolves.toEqual(
        expect.objectContaining({
          turns: [
            expect.objectContaining({
              memory: [expect.objectContaining({ job: completed, receipts: [providerFinal] })],
            }),
          ],
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('seals provider evidence as absent when the bounded wait expires', async () => {
    jest.useFakeTimers();
    const checkpointed = {
      ...makeJob('processing'),
      structuralCompletedAt: 2,
    };
    mockedGetIngestionJob.mockReturnValue(checkpointed);

    try {
      const sealing = sealForegroundScenarioMemoryEvidenceAfterProviderWait({
        memoryScope: MEMORY_SCOPE,
        turns: [
          {
            memory: [
              {
                publication: { disposition: 'enqueued', jobId: checkpointed.id },
                job: checkpointed,
                receipts: [],
              },
            ],
          } as never,
        ],
        requirements: [{ turnIndex: 0, providerOutcome: 'valid' }],
        timeoutMs: 50,
      });
      await jest.advanceTimersByTimeAsync(50);

      await expect(sealing).resolves.toEqual(
        expect.objectContaining({
          turns: [
            expect.objectContaining({
              memory: [expect.objectContaining({ job: checkpointed, receipts: [] })],
            }),
          ],
        }),
      );
      expect(mockedListIngestionDurabilityReceipts.mock.calls.length).toBeLessThanOrEqual(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it('seals late jobs, facts, episodes, and receipts under one coherent read transaction', () => {
    const checkpointed = {
      ...makeJob('processing'),
      structuralCompletedAt: 2,
    };
    const completed = {
      ...checkpointed,
      status: 'completed_enriched' as const,
      providerOutcome: 'valid' as const,
      completedAt: 3,
      updatedAt: 3,
    };
    const providerFinal = {
      phase: 'provider_final' as const,
      jobId: checkpointed.id,
      attemptNumber: 1,
      episodeId: 'episode-late',
      deterministicFactIds: [],
      providerFactIds: ['fact-late'],
      invalidatedFactIds: [],
      bridgedEvidenceFactIds: [],
      agentRunMemoryFactIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      providerOutcome: 'valid' as const,
      providerOutcomeCode: null,
      persistedAt: 3,
    };
    const finalState = makeEvidenceSnapshot({
      capturedAt: 3,
      facts: [
        {
          id: 'fact-late',
          subjectId: 'subject-opaque',
          subject: '主体',
          predicate: 'predicate-opaque',
          objectText: 'قيمة',
          contentHash: 'b'.repeat(64),
          confidence: 1,
          scope: 'global',
          memoryKind: 'fact',
          personaId: 'default',
          originConversationId: 'conversation',
          originThreadId: 'conversation',
          originTaskId: null,
          sourceMessageId: 'assistant-message',
          sourceRunId: null,
          sourceTurnId: 'assistant-message',
          validAt: 1,
          invalidAt: null,
          expiresAt: null,
          createdAt: 3,
          updatedAt: 3,
          deletedAt: null,
          pinned: false,
          reviewState: 'active',
          sensitivity: 'ordinary',
        },
      ],
      episodes: [
        {
          id: 'episode-late',
          conversationId: 'conversation',
          threadId: 'conversation',
          taskId: null,
          summary: '要約',
          messageIds: ['assistant-message'],
          toolNames: [],
          sourceStartMessageId: null,
          sourceEndMessageId: 'assistant-message',
          startedAt: 1,
          endedAt: 1,
          createdAt: 3,
          deletedAt: null,
        },
      ],
      ingestionJobs: [
        {
          id: completed.id,
          threadId: completed.threadId,
          memoryConversationId: completed.memoryConversationId,
          taskId: null,
          sourceRunId: null,
          priorUserMessageId: null,
          sourceStartMessageId: null,
          sourceEndMessageId: completed.sourceEndMessageId,
          sourceAt: completed.sourceAt,
          reason: completed.reason,
          status: completed.status,
          attemptCount: completed.attemptCount,
          providerEnrichment: completed.providerEnrichment,
          providerOutcome: completed.providerOutcome,
          outcomeCode: null,
          nextAttemptAt: null,
          structuralCompletedAt: completed.structuralCompletedAt,
          createdAt: completed.createdAt,
          updatedAt: completed.updatedAt,
          completedAt: completed.completedAt,
        },
      ],
    });
    let transactionActive = false;
    mockedRunMemoryTransaction.mockImplementation((callback) => {
      transactionActive = true;
      try {
        return callback() as never;
      } finally {
        transactionActive = false;
      }
    });
    mockedGetIngestionJob.mockImplementation(() => {
      expect(transactionActive).toBe(true);
      return completed;
    });
    mockedListIngestionDurabilityReceipts.mockImplementation(() => {
      expect(transactionActive).toBe(true);
      return [providerFinal];
    });
    mockedCaptureCompleteMemoryEvidence.mockImplementation(() => {
      expect(transactionActive).toBe(true);
      return finalState;
    });

    const sealed = sealForegroundScenarioMemoryEvidence({
      memoryScope: MEMORY_SCOPE,
      turns: [
        {
          memory: [
            {
              publication: { disposition: 'enqueued', jobId: checkpointed.id },
              job: checkpointed,
              receipts: [],
            },
          ],
        } as never,
      ],
    });

    expect(sealed.turns[0]!.memory[0]).toEqual(
      expect.objectContaining({ job: completed, receipts: [providerFinal] }),
    );
    expect(sealed.memoryFinalState).toEqual(finalState);
    expect(sealed.memoryFinalState.facts.map((fact) => fact.id)).toEqual(['fact-late']);
    expect(sealed.memoryFinalState.episodes.map((episode) => episode.id)).toEqual(['episode-late']);
  });

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
