jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  claimIngestionJob,
  completeIngestionJob,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  ownsIngestionClaim,
} from '../../../src/services/memory/ingestionQueueStore';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import { applyThreadLocalConsolidatorResult } from '../../../src/services/memory/consolidator';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { seedConversation } from '../../../src/services/memory/migrationSeedPass';
import { CONSOLIDATION_FACT_PRODUCER_IDS } from '../../../src/services/memory/consolidation/factContributionIdentity';
import type { Conversation } from '../../../src/types/conversation';
import type { Message } from '../../../src/types/message';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const SCOPE = {
  memoryConversationId: 'conversation-1',
  threadId: 'thread-1',
  taskId: 'task-1',
};

function enqueue(overrides: Partial<Parameters<typeof enqueueIngestionJob>[0]> = {}) {
  return enqueueIngestionJob({
    personaId: 'default',
    memoryConversationId: SCOPE.memoryConversationId,
    threadId: SCOPE.threadId,
    threadTitle: null,
    taskId: SCOPE.taskId,
    sourceStartMessageId: 'message-old',
    sourceEndMessageId: 'turn-old',
    sourceRunId: 'run-old',
    sourceAt: 500,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 500,
    ...overrides,
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('withdrawal ingestion replay fence', () => {
  it('revokes a processing claim and rejects exact stale-source replay', () => {
    const entity = upsertEntity({ name: 'user', type: 'self', now: 100 });
    const fact = recordFact({
      subjectId: entity.id,
      predicate: 'private_value',
      objectText: 'withdraw me',
      scope: 'session',
      originConversationId: SCOPE.memoryConversationId,
      originThreadId: SCOPE.threadId,
      originTaskId: SCOPE.taskId,
      sourceMessageId: 'message-old',
      sourceTurnId: 'turn-old',
      sourceRunId: 'run-old',
      supersedePrior: false,
      now: 200,
    }).fact;
    const processingJob = enqueue();
    if (!processingJob) throw new Error('expected job');
    const claimToken = claimIngestionJob(processingJob.id, 600);
    if (!claimToken) throw new Error('expected claim');
    expect(ownsIngestionClaim(processingJob.id, claimToken, 601)).toBe(true);

    expect(withdrawMemoryFact(fact.id, 700).status).toBe('withdrawn');

    expect(getIngestionJob(processingJob.id)).toBeNull();
    expect(ownsIngestionClaim(processingJob.id, claimToken, 701)).toBe(false);
    expect(
      completeIngestionJob(
        processingJob.id,
        'completed_structural',
        'structural_only',
        702,
        claimToken,
      ),
    ).toBe(false);
    expect(enqueue({ now: 800 })).toBeNull();
  });

  it('does not cross source kinds, source threads, tasks, or new assertions', () => {
    const entity = upsertEntity({ name: 'user', type: 'self', now: 100 });
    const fact = recordFact({
      subjectId: entity.id,
      predicate: 'private_value',
      objectText: 'withdraw me',
      scope: 'session',
      originConversationId: SCOPE.memoryConversationId,
      originThreadId: SCOPE.threadId,
      originTaskId: SCOPE.taskId,
      sourceMessageId: 'shared-source-id',
      sourceTurnId: 'turn-old',
      sourceRunId: 'run-old',
      supersedePrior: false,
      now: 200,
    }).fact;
    expect(withdrawMemoryFact(fact.id, 300).status).toBe('withdrawn');

    expect(
      enqueue({
        sourceStartMessageId: 'message-new',
        sourceEndMessageId: 'turn-new-kind',
        sourceRunId: 'shared-source-id',
      }),
    ).not.toBeNull();
    expect(
      enqueue({
        threadId: 'thread-other',
        sourceStartMessageId: 'shared-source-id',
        sourceEndMessageId: 'turn-new-thread',
        sourceRunId: 'run-new-thread',
      }),
    ).not.toBeNull();
    expect(
      enqueue({
        taskId: 'task-other',
        sourceStartMessageId: 'shared-source-id',
        sourceEndMessageId: 'turn-new-task',
        sourceRunId: 'run-new-task',
      }),
    ).not.toBeNull();
    expect(
      enqueue({
        sourceStartMessageId: 'message-new',
        sourceEndMessageId: 'turn-new',
        sourceRunId: 'run-new',
      }),
    ).not.toBeNull();
  });

  it('rejects migration and direct-persistence replay before any memory write', () => {
    const entity = upsertEntity({ name: 'user', type: 'self', now: 100 });
    const fact = recordFact({
      subjectId: entity.id,
      predicate: 'private_value',
      objectText: 'withdraw me',
      scope: 'session',
      originConversationId: SCOPE.memoryConversationId,
      originThreadId: SCOPE.threadId,
      originTaskId: SCOPE.taskId,
      sourceMessageId: 'message-old',
      sourceTurnId: 'turn-old',
      sourceRunId: 'run-old',
      supersedePrior: false,
      now: 200,
    }).fact;
    expect(withdrawMemoryFact(fact.id, 300).status).toBe('withdrawn');
    const replayResult = {
      episodeSummary: 'must not return',
      newFacts: [
        {
          subject: 'user',
          predicate: 'private_value',
          value: 'must not return',
          confidence: 0.9,
          evidenceMessageIds: ['message-old'],
        },
      ],
      activeFocus: null,
      openThreads: [],
      notable: [],
    };

    expect(() =>
      applyThreadLocalConsolidatorResult(replayResult, {
        conversationId: SCOPE.memoryConversationId,
        threadId: SCOPE.threadId,
        taskId: SCOPE.taskId,
        sourceUserMessageId: 'message-old',
        sourceAssistantMessageId: 'turn-old',
        factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport,
        sourceRunId: 'run-old',
        now: 400,
      }),
    ).toThrow('Memory persistence source withdrawn');
    expect(listFacts({ originConversationId: SCOPE.memoryConversationId })).toEqual([]);
    expect(listEpisodes({ conversationId: SCOPE.memoryConversationId })).toEqual([]);

    expect(() =>
      applyThreadLocalConsolidatorResult(
        {
          ...replayResult,
          newFacts: replayResult.newFacts.map((fact) => ({
            ...fact,
            evidenceMessageIds: ['message-new'],
          })),
        },
        {
          conversationId: SCOPE.memoryConversationId,
          threadId: SCOPE.threadId,
          taskId: SCOPE.taskId,
          sourceUserMessageId: 'message-new',
          sourceAssistantMessageId: 'turn-new',
          factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport,
          sourceRunId: 'run-new',
          now: 500,
        },
      ),
    ).not.toThrow();
    expect(listFacts({ originConversationId: SCOPE.memoryConversationId })).toHaveLength(1);
    expect(listEpisodes({ conversationId: SCOPE.memoryConversationId })).toHaveLength(1);
  });

  it('fails a migration replay checkpoint instead of resurrecting withdrawn sources', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const conversationId = 'conversation-migration-replay';
    const userMessageId = 'message-migration-old';
    const assistantMessageId = 'turn-migration-old';
    const entity = upsertEntity({ name: 'migration-user', type: 'self', now: 100 });
    const fact = recordFact({
      subjectId: entity.id,
      predicate: 'private_value',
      objectText: 'withdraw migration value',
      scope: 'conversation',
      originConversationId: conversationId,
      originThreadId: conversationId,
      sourceMessageId: userMessageId,
      sourceTurnId: assistantMessageId,
      supersedePrior: false,
      now: 200,
    }).fact;
    expect(withdrawMemoryFact(fact.id, 300).status).toBe('withdrawn');
    const messages: Message[] = [
      { id: userMessageId, role: 'user', content: 'remember this', timestamp: 100 },
      { id: assistantMessageId, role: 'assistant', content: 'noted', timestamp: 200 },
    ];
    const conversation = {
      id: conversationId,
      title: 'Migration replay',
      messages,
    } as Pick<Conversation, 'id' | 'title' | 'messages'>;

    const result = await seedConversation({
      conversation,
      now: 400,
      extractor: async () =>
        JSON.stringify({
          new_facts: [
            {
              subject: 'migration-user',
              predicate: 'private_value',
              value: 'withdraw migration value',
              confidence: 0.9,
            },
          ],
          episode_summary: 'must not return',
          active_focus: null,
          open_threads: [],
          notable: [],
        }),
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'error', error: 'persistence_failed', seededTurns: 0 }),
    );
    expect(listFacts({ originConversationId: conversationId })).toEqual([]);
    expect(listEpisodes({ conversationId })).toEqual([]);
    warnSpy.mockRestore();
  });
});
