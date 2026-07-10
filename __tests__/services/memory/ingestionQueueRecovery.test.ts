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
  getIngestionQueueDiagnostics,
  getIngestionJob,
  INGESTION_PROCESSING_LEASE_MS,
  INGESTION_RETRY_BASE_DELAY_MS,
  recoverStaleIngestionJobs,
} from '../../../src/services/memory/ingestionQueue';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordEpisode } from '../../../src/services/memory/episodes/mutations';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import {
  claimIngestionJob,
  completeIngestionJob,
  markIngestionJobStructuralComplete,
  ownsIngestionClaim,
  retryOrCompleteIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import type { Message } from '../../../src/types/message';

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
  it('reconciles an exact committed episode before terminal stale recovery', () => {
    const job = enqueueIngestionJob({
      threadId: 'thread-crash-window',
      memoryConversationId: 'memory-crash-window',
      sourceStartMessageId: 'user-crash-window',
      sourceEndMessageId: 'assistant-crash-window',
      now: 10,
    })!;
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 5,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-episode-crash'
        WHERE id = ?`,
      job.id,
    );
    const episode = recordEpisode({
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
      threadId: 'thread-fact-crash-window',
      memoryConversationId: 'memory-fact-crash-window',
      sourceEndMessageId: 'assistant-fact-crash-window',
      now: 10,
    })!;
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 5,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-fact-crash'
        WHERE id = ?`,
      job.id,
    );
    const subject = upsertEntity({ type: 'self', name: 'user', now: 50 });
    const persisted = recordFact({
      subjectId: subject.id,
      predicate: 'prefers',
      objectText: 'quiet mornings',
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
      threadId: 'conv-stale-retry',
      sourceEndMessageId: 'assistant-stale-retry',
      now: 10,
    });
    const exhausted = enqueueIngestionJob({
      threadId: 'conv-stale-failed',
      sourceEndMessageId: 'assistant-stale-failed',
      now: 10,
    });
    const structurallyCompleted = enqueueIngestionJob({
      threadId: 'conv-stale-degraded',
      sourceEndMessageId: 'assistant-stale-degraded',
      now: 10,
    });
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 1,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-retryable'
        WHERE id = ?`,
      retryable!.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 5,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-exhausted'
        WHERE id = ?`,
      exhausted!.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'processing', attempt_count = 5,
              next_attempt_at = NULL, lease_expires_at = 100,
              claim_token = 'claim-structural',
              structural_completed_at = 50
        WHERE id = ?`,
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
      threadId: 'thread-claim-fence',
      sourceEndMessageId: 'assistant-claim-fence',
      now: 10,
    })!;
    const firstClaim = claimIngestionJob(job.id, 10)!;
    expect(ownsIngestionClaim(job.id, firstClaim, 11)).toBe(true);
    expect(ownsIngestionClaim(job.id, firstClaim, 10 + INGESTION_PROCESSING_LEASE_MS)).toBe(false);

    recoverStaleIngestionJobs(10 + INGESTION_PROCESSING_LEASE_MS);
    const retry = getIngestionJob(job.id)!;
    const secondClaim = claimIngestionJob(job.id, retry.nextAttemptAt!)!;

    expect(markIngestionJobStructuralComplete(job.id, retry.nextAttemptAt!, firstClaim)).toBe(
      false,
    );
    expect(
      completeIngestionJob(
        job.id,
        'completed_enriched',
        'valid',
        retry.nextAttemptAt!,
        firstClaim,
      ),
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

  it('reports bounded state and provider-outcome aggregates', async () => {
    const structural = enqueueIngestionJob({
      threadId: 'conv-diagnostics-structural',
      sourceStartMessageId: 'user-diagnostics-structural',
      sourceEndMessageId: 'assistant-diagnostics-structural',
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
      threadId: 'conv-diagnostics-retrying',
      sourceStartMessageId: 'user-diagnostics-retrying',
      sourceEndMessageId: 'assistant-diagnostics-retrying',
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
