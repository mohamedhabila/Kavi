jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { applyThreadLocalConsolidatorResult } from '../../../src/services/memory/consolidator';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  INGESTION_PROCESSING_LEASE_MS,
  recoverStaleIngestionJobs,
} from '../../../src/services/memory/ingestionQueue';
import {
  claimIngestionJob,
  completeIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';
import { CONSOLIDATION_FACT_PRODUCER_IDS } from '../../../src/services/memory/consolidation/factContributionIdentity';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

it('checks queue ownership inside the same transaction as memory persistence', () => {
  expect(() =>
    applyThreadLocalConsolidatorResult(
      {
        episodeSummary: 'This stale attempt must not persist.',
        newFacts: [
          {
            subject: 'user',
            predicate: 'prefers',
            value: 'quiet mornings',
            confidence: 0.9,
          },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        conversationId: 'conv-fenced-persistence',
        threadId: 'conv-fenced-persistence',
        sourceAssistantMessageId: 'assistant-fenced-persistence',
        factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport,
        canPersist: () => false,
        now: 10,
      },
    ),
  ).toThrow('Memory persistence claim lost');
  expect(listEpisodes({ conversationId: 'conv-fenced-persistence' })).toEqual([]);
  expect(listFacts({ originConversationId: 'conv-fenced-persistence' })).toEqual([]);
});

it('commits a final enriched-attempt receipt atomically with memory writes', () => {
  const job = enqueueIngestionJob({
    personaId: 'default',
    threadId: 'conv-enriched-receipt',
    threadTitle: null,
    memoryConversationId: 'conv-enriched-receipt',
    taskId: null,
    sourceStartMessageId: null,
    sourceEndMessageId: 'assistant-enriched-receipt',
    sourceRunId: null,
    sourceAt: 100,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 100,
  })!;
  getMemoryDb().runSync('UPDATE memory_ingestion_jobs SET attempt_count = 4 WHERE id = ?', job.id);
  const claimToken = claimIngestionJob(job.id, 100)!;

  applyThreadLocalConsolidatorResult(
    {
      episodeSummary: 'The validated enrichment committed.',
      newFacts: [],
      activeFocus: null,
      openThreads: [],
      notable: [],
    },
    {
      conversationId: job.memoryConversationId,
      threadId: job.threadId,
      sourceAssistantMessageId: job.sourceEndMessageId,
      factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport,
      canPersist: () => true,
      commitReceipt: () =>
        completeIngestionJob(job.id, 'completed_enriched', 'valid', 101, claimToken),
      now: 101,
    },
  );

  expect(getIngestionJob(job.id)).toEqual(
    expect.objectContaining({
      status: 'completed_enriched',
      attemptCount: 5,
      providerOutcome: 'valid',
      structuralCompletedAt: 101,
    }),
  );
  expect(listEpisodes({ conversationId: job.memoryConversationId })).toHaveLength(1);
  expect(recoverStaleIngestionJobs(100 + INGESTION_PROCESSING_LEASE_MS)).toEqual({
    retrying: 0,
    degraded: 0,
    failed: 0,
  });
  expect(getIngestionJob(job.id)?.status).toBe('completed_enriched');
});

it('keeps durable persistence successful when working focus overflows', () => {
  expect(() =>
    applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [],
        activeFocus: 'x'.repeat(5_000),
        openThreads: [],
        notable: [],
      },
      {
        conversationId: 'conv-overflow-focus',
        threadId: 'conv-overflow-focus',
        sourceAssistantMessageId: 'assistant-overflow-focus',
        factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport,
        now: 1,
      },
    ),
  ).not.toThrow();
});
