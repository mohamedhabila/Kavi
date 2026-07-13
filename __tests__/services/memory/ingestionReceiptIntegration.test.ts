jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  commitIngestionPersistenceReceipt,
  IngestionReceiptCommitError,
  listIngestionPersistenceReceipts,
} from '../../../src/services/memory/ingestionReceiptStore';
import {
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  processIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import { claimIngestionJob } from '../../../src/services/memory/ingestionQueueStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import type { Message } from '../../../src/types/message';
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';
import { CONSOLIDATION_FACT_PRODUCER_IDS } from '../../../src/services/memory/consolidation/factContributionIdentity';
import { AGENT_RUN_FACT_CONTRIBUTION_PRODUCER_ID } from '../../../src/services/memory/agentRunFactContributionIdentity';

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

function closedFileTurn(suffix: string): Message[] {
  return [
    {
      id: `user-${suffix}`,
      role: 'user',
      content: 'Create the release manifest.',
      timestamp: 90,
    },
    {
      id: `assistant-tool-${suffix}`,
      role: 'assistant',
      content: '',
      timestamp: 91,
      toolCalls: [
        {
          id: `tool-call-${suffix}`,
          name: 'write_file',
          arguments: JSON.stringify({ path: 'dist/release-manifest.json' }),
          status: 'completed',
        },
      ],
      assistantMetadata: {
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'tool_calls',
      },
    },
    {
      id: `tool-result-${suffix}`,
      role: 'tool',
      content: 'ok',
      timestamp: 92,
      toolCallId: `tool-call-${suffix}`,
    },
    {
      id: `assistant-${suffix}`,
      role: 'assistant',
      content: 'The manifest is ready.',
      timestamp: 93,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

function factContributions(memoryConversationId: string) {
  return getMemoryDb().getAllSync<{ fact_id: string; producer_id: string }>(
    `SELECT fact_id, producer_id
       FROM memory_fact_contributions
      WHERE memory_conversation_id = ?
      ORDER BY fact_id ASC`,
    memoryConversationId,
  );
}

describe('memory ingestion receipt integration', () => {
  it('commits the production turn write set with its queue transition', async () => {
    const messages = closedFileTurn('integrated');
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conversation-integrated-receipt',
      threadTitle: null,
      memoryConversationId: 'conversation-integrated-receipt',
      taskId: null,
      sourceStartMessageId: 'user-integrated',
      sourceEndMessageId: 'assistant-integrated',
      sourceRunId: 'run-integrated',
      sourceAt: 100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: false,
      now: 100,
      sourceSnapshot: encodeIngestionSourceSnapshot({
        messages,
        priorUserMessageId: null,
        sourceStartMessageId: 'user-integrated',
        sourceEndMessageId: 'assistant-integrated',
      }),
    })!;

    const result = await processIngestionJob({
      jobId: job.id,
      now: 100,
    });

    expect(result).toEqual({ processed: true, status: 'completed_structural' });
    const [receipt] = listIngestionPersistenceReceipts(job.id);
    expect(receipt).toEqual(
      expect.objectContaining({
        attemptNumber: 1,
        episodeId: expect.any(String),
        deterministicFactIds: [expect.any(String)],
        agentRunMemoryFactIds: [expect.any(String)],
        providerFactIds: [],
        invalidatedFactIds: [],
        activeFocusUpdated: false,
        openThreadsUpdated: false,
        providerOutcome: 'structural_only',
        providerOutcomeCode: null,
        persistedAt: 100,
      }),
    );
    expect(
      listFacts({ originConversationId: job.memoryConversationId }).map((fact) => fact.id),
    ).toEqual(expect.arrayContaining(receipt!.deterministicFactIds));
    expect(factContributions(job.memoryConversationId)).toEqual([
      ...receipt!.deterministicFactIds.map((factId) => ({
        fact_id: factId,
        producer_id: CONSOLIDATION_FACT_PRODUCER_IDS.structuralTurn,
      })),
      ...receipt!.agentRunMemoryFactIds.map((factId) => ({
        fact_id: factId,
        producer_id: AGENT_RUN_FACT_CONTRIBUTION_PRODUCER_ID,
      })),
    ]);
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({ status: 'completed_structural', attemptCount: 1 }),
    );
  });

  it('rolls memory writes back when receipt ownership is lost at commit time', async () => {
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conversation-receipt-race',
      threadTitle: null,
      memoryConversationId: 'conversation-receipt-race',
      taskId: null,
      sourceStartMessageId: 'user-race',
      sourceEndMessageId: 'assistant-race',
      sourceRunId: null,
      sourceAt: 200,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: false,
      now: 200,
    })!;
    const claimToken = claimIngestionJob(job.id, 200)!;

    await expect(
      processIngestionTurn({
        episodeAccess: { personaId: 'default', shareability: 'thread_only' },
        threadId: job.threadId,
        memoryConversationId: job.memoryConversationId,
        messages: closedFileTurn('race'),
        sourceEndMessageId: job.sourceEndMessageId,
        now: 200,
        skipWorkingMemorySync: true,
        canPersist: () => true,
        commitPersistenceReceipt: ({ providerOutcome, ...writeSet }) => {
          expect(providerOutcome).toEqual({ status: 'not_requested' });
          commitIngestionPersistenceReceipt({
            ...writeSet,
            jobId: job.id,
            claimToken: `${claimToken}-stale`,
            providerOutcome: 'structural_only',
            providerOutcomeCode: null,
            persistedAt: 200,
          });
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<IngestionReceiptCommitError>>({ code: 'claim_lost' }),
    );

    expect(listEpisodes({ conversationId: job.memoryConversationId })).toEqual([]);
    expect(listFacts({ originConversationId: job.memoryConversationId })).toEqual([]);
    expect(factContributions(job.memoryConversationId)).toEqual([]);
    expect(listIngestionPersistenceReceipts(job.id)).toEqual([]);
    expect(getIngestionJob(job.id)?.status).toBe('processing');
  });

  it('commits provider contributions with the final enriched receipt', async () => {
    const messages: Message[] = [
      {
        id: 'user-provider-receipt',
        role: 'user',
        content: 'My preferred channel is Signal.',
        timestamp: 299,
      },
      {
        id: 'assistant-provider-receipt',
        role: 'assistant',
        content: 'I will remember that.',
        timestamp: 300,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
      },
    ];
    const job = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conversation-provider-receipt',
      threadTitle: null,
      memoryConversationId: 'conversation-provider-receipt',
      taskId: null,
      sourceStartMessageId: 'user-provider-receipt',
      sourceEndMessageId: 'assistant-provider-receipt',
      sourceRunId: null,
      sourceAt: 300,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 300,
    })!;
    const claimToken = claimIngestionJob(job.id, 300)!;

    const result = await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: job.threadId,
      memoryConversationId: job.memoryConversationId,
      messages,
      sourceEndMessageId: job.sourceEndMessageId,
      now: 300,
      skipWorkingMemorySync: true,
      canPersist: () => true,
      extractor: async () =>
        JSON.stringify({
          new_facts: [
            {
              subject: 'user',
              predicate: 'preferred_channel',
              value: 'Signal',
              scope: 'conversation',
              operation: 'replace_current',
              assertion_class: 'current_direct',
              evidence_message_ids: ['user-provider-receipt'],
              evidence_quote: 'My preferred channel is Signal.',
            },
          ],
          episode_summary: null,
          active_focus: null,
          open_threads: [],
          notable: [],
        }),
      commitPersistenceReceipt: ({ providerOutcome, ...writeSet }) => {
        expect(providerOutcome).toEqual({ status: 'valid' });
        commitIngestionPersistenceReceipt({
          ...writeSet,
          jobId: job.id,
          claimToken,
          providerOutcome: 'valid',
          providerOutcomeCode: null,
          persistedAt: 300,
        });
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        processed: true,
        enriched: true,
        providerFactIds: [expect.any(String)],
      }),
    );
    const [receipt] = listIngestionPersistenceReceipts(job.id);
    expect(receipt).toEqual(
      expect.objectContaining({
        providerOutcome: 'valid',
        providerFactIds: result.providerFactIds,
      }),
    );
    expect(factContributions(job.memoryConversationId)).toEqual([
      {
        fact_id: result.providerFactIds[0],
        producer_id: CONSOLIDATION_FACT_PRODUCER_IDS.providerTurn,
      },
    ]);
    expect(getIngestionJob(job.id)?.status).toBe('completed_enriched');
  });
});
