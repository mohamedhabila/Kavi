jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/memory/consolidation/paths', () => ({
  resolveConsolidationPath: jest.fn(async () => ({
    tier: 'deterministic',
    provider: null,
    model: null,
    extractor: null,
  })),
}));

jest.mock('../../../src/services/memory/turnProcessor', () => ({
  processIngestionTurn: jest.fn(async () => ({
    processed: true,
    episodeId: 'ep-1',
    deterministicFactIds: ['fact-1'],
    providerFactIds: [],
    invalidatedFactIds: [],
    activeFocusUpdated: true,
    openThreadsUpdated: false,
    enriched: false,
    providerOutcome: { status: 'not_requested' },
  })),
}));

import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob,
  getIngestionJob,
  INGESTION_PROCESSING_LEASE_MS,
  INGESTION_RETRY_BASE_DELAY_MS,
  recoverStaleIngestionJobs,
} from '../../../src/services/memory/ingestionQueue';
import { getIngestionQueueDiagnostics } from '../../../src/services/memory/ingestionQueueDiagnostics';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordThreadLocalEpisode } from '../../../src/services/memory/episodes/mutations';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import {
  claimIngestionJob,
  claimIngestionJobForStructuralCheckpoint,
  completeIngestionJob,
  markIngestionJobStructuralComplete,
  ownsIngestionClaim,
  retryOrCompleteIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import type { Message } from '../../../src/types/message';
import { getRuntimeProcessEpoch } from '../../../src/services/runtimeProcessEpoch';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mockedProcessIngestionTurn = processIngestionTurn as jest.MockedFunction<
  typeof processIngestionTurn
>;

function processResult(
  providerOutcome: Awaited<ReturnType<typeof processIngestionTurn>>['providerOutcome'],
): Awaited<ReturnType<typeof processIngestionTurn>> {
  return {
    processed: true,
    episodeId: 'ep-1',
    deterministicFactIds: ['fact-1'],
    providerFactIds: [],
    invalidatedFactIds: [],
    activeFocusUpdated: true,
    openThreadsUpdated: false,
    enriched: providerOutcome.status === 'valid',
    providerOutcome,
    bridgedEvidenceFactIds: [],
    agentRunMemoryFactIds: [],
  };
}

function closedTurn(suffix: string): Message[] {
  return [
    {
      id: `user-${suffix}`,
      role: 'user',
      content: 'Remember this',
      createdAt: 1,
    },
    {
      id: `assistant-${suffix}`,
      role: 'assistant',
      content: 'Done',
      createdAt: 2,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
});

afterEach(() => {
  closeMemoryDb();
});

describe('ingestion queue recovery and diagnostics', () => {
  it('reconciles an exact committed episode before recovering a foreign-process claim', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-crash-window',
      threadTitle: null,
      memoryConversationId: 'memory-crash-window',
      taskId: null,
      sourceStartMessageId: 'user-crash-window',
      sourceEndMessageId: 'assistant-crash-window',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 10,
    })!;
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 5,
              next_attempt_at = NULL, lease_expires_at = 1_000,
              claim_token = 'claim-episode-crash', claim_process_epoch = ?
        WHERE id = ?`,
      `${getRuntimeProcessEpoch()}-foreign`,
      job.id,
    );
    const episode = recordThreadLocalEpisode({
      conversationId: 'memory-crash-window',
      threadId: 'thread-crash-window',
      sourceStartMessageId: 'user-crash-window',
      sourceEndMessageId: 'assistant-crash-window',
      messageIds: ['user-crash-window', 'assistant-crash-window'],
      summary: 'The structural write committed before the queue transition.',
      now: 50,
    });

    expect(recoverStaleIngestionJobs(100)).toEqual({ retrying: 0, degraded: 1, failed: 0 });
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'degraded',
        structuralCompletedAt: episode!.createdAt,
        outcomeCode: 'stale_processing_lease',
      }),
    );
  });

  it('reconciles an exact committed fact when the turn produced no episode', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-fact-crash-window',
      threadTitle: null,
      memoryConversationId: 'memory-fact-crash-window',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-fact-crash-window',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 10,
    })!;
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 5,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-fact-crash', claim_process_epoch = ?
        WHERE id = ?`,
      getRuntimeProcessEpoch(),
      job.id,
    );
    const subject = upsertEntity({ type: 'self', name: 'user', now: 50 });
    const persisted = recordFact({
      subjectId: subject.id,
      predicate: 'prefers',
      objectText: 'quiet mornings',
      scope: 'conversation',
      originConversationId: 'memory-fact-crash-window',
      originThreadId: 'thread-fact-crash-window',
      sourceTurnId: 'assistant-fact-crash-window',
      now: 50,
    });

    expect(recoverStaleIngestionJobs(100)).toEqual({ retrying: 0, degraded: 1, failed: 0 });
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'degraded',
        structuralCompletedAt: persisted.fact.createdAt,
        outcomeCode: 'stale_processing_lease',
      }),
    );
  });

  it('accounts for retrying, failed, and structurally completed stale leases', () => {
    const retryable = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-stale-retry',
      threadTitle: null,
      memoryConversationId: 'conv-stale-retry',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-stale-retry',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 10,
    });
    const exhausted = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-stale-failed',
      threadTitle: null,
      memoryConversationId: 'conv-stale-failed',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-stale-failed',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 10,
    });
    const structurallyCompleted = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-stale-degraded',
      threadTitle: null,
      memoryConversationId: 'conv-stale-degraded',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-stale-degraded',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 10,
    });
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 1,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-retryable', claim_process_epoch = ?
        WHERE id = ?`,
      getRuntimeProcessEpoch(),
      retryable!.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 5,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-exhausted', claim_process_epoch = ?
        WHERE id = ?`,
      getRuntimeProcessEpoch(),
      exhausted!.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 5,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-structural',
              claim_process_epoch = ?,
              structural_completed_at = 50
        WHERE id = ?`,
      getRuntimeProcessEpoch(),
      structurallyCompleted!.id,
    );

    expect(recoverStaleIngestionJobs(100)).toEqual({
      retrying: 1,
      degraded: 1,
      failed: 1,
    });
    expect(getIngestionJob(retryable!.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        outcomeCode: 'stale_processing_lease',
        nextAttemptAt: 100 + INGESTION_RETRY_BASE_DELAY_MS,
      }),
    );
    expect(getIngestionJob(exhausted!.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        outcomeCode: 'stale_processing_lease',
        nextAttemptAt: null,
        completedAt: 100,
      }),
    );
    expect(getIngestionJob(structurallyCompleted!.id)).toEqual(
      expect.objectContaining({
        status: 'degraded',
        outcomeCode: 'stale_processing_lease',
        structuralCompletedAt: 50,
        nextAttemptAt: null,
        completedAt: 100,
      }),
    );
  });

  it('fences every stale owner transition after a new attempt claims the job', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-claim-fence',
      threadTitle: null,
      memoryConversationId: 'thread-claim-fence',
      taskId: null,
      sourceStartMessageId: null,
      sourceEndMessageId: 'assistant-claim-fence',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 10,
    })!;
    const firstClaim = claimIngestionJob(job.id, 10)!;
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        claimProcessEpoch: getRuntimeProcessEpoch(),
        leaseExpiresAt: 10 + INGESTION_PROCESSING_LEASE_MS,
      }),
    );
    expect(ownsIngestionClaim(job.id, firstClaim, 11)).toBe(true);
    expect(ownsIngestionClaim(job.id, firstClaim, 10 + INGESTION_PROCESSING_LEASE_MS)).toBe(false);

    recoverStaleIngestionJobs(10 + INGESTION_PROCESSING_LEASE_MS);
    const retry = getIngestionJob(job.id)!;
    const secondClaim = claimIngestionJob(job.id, retry.nextAttemptAt!)!;

    expect(markIngestionJobStructuralComplete(job.id, retry.nextAttemptAt!, firstClaim)).toBe(
      false,
    );
    expect(
      completeIngestionJob(job.id, 'completed_enriched', 'valid', retry.nextAttemptAt!, firstClaim),
    ).toBe(false);
    expect(
      retryOrCompleteIngestionJob({
        jobId: job.id,
        providerOutcome: 'provider_error',
        outcomeCode: 'provider_request_failed',
        now: retry.nextAttemptAt!,
        claimToken: firstClaim,
      }),
    ).toEqual({ status: 'processing', applied: false });
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({ status: 'processing', claimToken: secondClaim }),
    );
    expect(
      completeIngestionJob(
        job.id,
        'completed_enriched',
        'valid',
        retry.nextAttemptAt!,
        secondClaim,
      ),
    ).toBe(true);
  });

  it('stamps structural-checkpoint claims with the current process epoch', () => {
    const prior = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-structural-claim',
      threadTitle: null,
      memoryConversationId: 'thread-structural-claim',
      taskId: null,
      sourceStartMessageId: 'user-structural-prior',
      sourceEndMessageId: 'assistant-structural-prior',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 10,
    })!;
    const successor = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-structural-claim',
      threadTitle: null,
      memoryConversationId: 'thread-structural-claim',
      taskId: null,
      priorUserMessageId: 'user-structural-prior',
      sourceStartMessageId: 'user-structural-successor',
      sourceEndMessageId: 'assistant-structural-successor',
      sourceRunId: null,
      sourceAt: 11,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 11,
    })!;
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'retrying', structural_completed_at = 10, next_attempt_at = 1_000
        WHERE id = ?`,
      prior.id,
    );

    expect(claimIngestionJob(successor.id, 11)).toBeNull();
    const claim = claimIngestionJobForStructuralCheckpoint(successor.id, 11);

    expect(claim).not.toBeNull();
    expect(getIngestionJob(successor.id)).toEqual(
      expect.objectContaining({
        status: 'processing',
        claimToken: claim,
        claimProcessEpoch: getRuntimeProcessEpoch(),
        leaseExpiresAt: 11 + INGESTION_PROCESSING_LEASE_MS,
      }),
    );
  });

  it('rejects normal owner transitions for a foreign-process claim', () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-foreign-owner',
      threadTitle: null,
      memoryConversationId: 'thread-foreign-owner',
      taskId: null,
      sourceStartMessageId: 'user-foreign-owner',
      sourceEndMessageId: 'assistant-foreign-owner',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 10,
    })!;
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 1, next_attempt_at = NULL,
              lease_expires_at = 1_000, claim_token = 'foreign-owner-claim',
              claim_process_epoch = ?
        WHERE id = ?`,
      `${getRuntimeProcessEpoch()}-foreign`,
      job.id,
    );

    expect(ownsIngestionClaim(job.id, 'foreign-owner-claim', 100)).toBe(false);
    expect(markIngestionJobStructuralComplete(job.id, 100, 'foreign-owner-claim')).toBe(false);
    expect(
      completeIngestionJob(job.id, 'completed_enriched', 'valid', 100, 'foreign-owner-claim'),
    ).toBe(false);
    expect(
      retryOrCompleteIngestionJob({
        jobId: job.id,
        providerOutcome: null,
        outcomeCode: 'processing_error',
        now: 100,
        claimToken: 'foreign-owner-claim',
      }),
    ).toEqual({ status: 'processing', applied: false });
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'processing',
        claimProcessEpoch: `${getRuntimeProcessEpoch()}-foreign`,
      }),
    );
  });

  it('recovers and processes a foreign-process claim in the same drain', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'thread-foreign-drain',
      threadTitle: null,
      memoryConversationId: 'thread-foreign-drain',
      taskId: null,
      sourceStartMessageId: 'user-foreign-drain',
      sourceEndMessageId: 'assistant-foreign-drain',
      sourceRunId: null,
      sourceAt: 10,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: false,
      now: 10,
    })!;
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 1, next_attempt_at = NULL,
              lease_expires_at = 1_000, claim_token = 'foreign-drain-claim',
              claim_process_epoch = ?
        WHERE id = ?`,
      `${getRuntimeProcessEpoch()}-foreign`,
      job.id,
    );

    await expect(
      drainIngestionQueue({
        loadMessagesForThread: () => closedTurn('foreign-drain'),
        now: 100,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ attempted: 1, completed: 1, completedStructural: 1 }),
    );
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'completed_structural',
        attemptCount: 2,
        claimToken: null,
        claimProcessEpoch: null,
        leaseExpiresAt: null,
      }),
    );
  });

  it('reports bounded state and provider-outcome aggregates', async () => {
    const structural = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-diagnostics-structural',
      threadTitle: null,
      memoryConversationId: 'conv-diagnostics-structural',
      taskId: null,
      sourceStartMessageId: 'user-diagnostics-structural',
      sourceEndMessageId: 'assistant-diagnostics-structural',
      sourceRunId: null,
      sourceAt: 100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: false,
      now: 100,
    });
    await drainIngestionQueue({
      loadMessagesForThread: () => closedTurn('diagnostics-structural'),
      now: 100,
    });

    mockedProcessIngestionTurn.mockResolvedValueOnce(
      processResult({ status: 'provider_error', code: 'provider_request_failed' }),
    );
    const retrying = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-diagnostics-retrying',
      threadTitle: null,
      memoryConversationId: 'conv-diagnostics-retrying',
      taskId: null,
      sourceStartMessageId: 'user-diagnostics-retrying',
      sourceEndMessageId: 'assistant-diagnostics-retrying',
      sourceRunId: null,
      sourceAt: 200,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 200,
    });
    await drainIngestionQueue({
      loadMessagesForThread: (threadId) =>
        threadId === 'conv-diagnostics-retrying' ? closedTurn('diagnostics-retrying') : [],
      now: 200,
    });

    const diagnostics = getIngestionQueueDiagnostics(200);
    expect(structural).not.toBeNull();
    expect(retrying).not.toBeNull();
    expect(diagnostics).toEqual(
      expect.objectContaining({ total: 2, dueRetryCount: 0, staleProcessingCount: 0 }),
    );
    expect(diagnostics.byStatus.completed_structural).toBe(1);
    expect(diagnostics.byStatus.retrying).toBe(1);
    expect(diagnostics.byProviderOutcome.structural_only).toBe(1);
    expect(diagnostics.byProviderOutcome.provider_error).toBe(1);
  });
});
