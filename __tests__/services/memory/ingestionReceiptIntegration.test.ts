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
  enqueueIngestionJob,
  getIngestionJob,
  processIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import { claimIngestionJob } from '../../../src/services/memory/ingestionQueueStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import type { Message } from '../../../src/types/message';

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
      createdAt: 90,
    },
    {
      id: `assistant-tool-${suffix}`,
      role: 'assistant',
      content: '',
      createdAt: 91,
      toolCalls: [
        {
          id: `tool-call-${suffix}`,
          name: 'write_file',
          arguments: JSON.stringify({ path: 'dist/release-manifest.json' }),
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
      createdAt: 92,
      toolCallId: `tool-call-${suffix}`,
    },
    {
      id: `assistant-${suffix}`,
      role: 'assistant',
      content: 'The manifest is ready.',
      createdAt: 93,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

describe('memory ingestion receipt integration', () => {
  it('commits the production turn write set with its queue transition', async () => {
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
    })!;

    const result = await processIngestionJob({
      jobId: job.id,
      messages: closedFileTurn('integrated'),
      now: 100,
    });

    expect(result).toEqual({ processed: true, status: 'completed_structural' });
    const [receipt] = listIngestionPersistenceReceipts(job.id);
    expect(receipt).toEqual(
      expect.objectContaining({
        attemptNumber: 1,
        episodeId: expect.any(String),
        deterministicFactIds: [expect.any(String)],
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
    expect(listIngestionPersistenceReceipts(job.id)).toEqual([]);
    expect(getIngestionJob(job.id)?.status).toBe('processing');
  });
});
