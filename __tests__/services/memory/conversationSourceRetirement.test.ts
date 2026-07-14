jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../../helpers/chatStoreHarness';
import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithContributionInTransaction } from '../../../src/services/memory/facts/mutations';
import { enqueueIngestionJob } from '../../../src/services/memory/ingestionQueue';
import {
  retireConversationSourcesForRewind,
  type ConversationRewindRetirementReason,
} from '../../../src/services/memory/conversationSourceRetirement';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { isMemorySourceWithdrawn } from '../../../src/services/memory/withdrawalFence';
import * as sourceRetirementCoordinator from '../../../src/services/memory/sourceRetirementCoordinator';
import { withIngestionSourceSnapshot } from '../../helpers/ingestionSourceSnapshotFixture';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function addPublishedTurn(input: {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  timestamp: number;
}): void {
  const store = useChatStore.getState();
  store.addMessage(input.conversationId, {
    id: input.userMessageId,
    role: 'user',
    content: 'طلب متعدد اللغات',
    timestamp: input.timestamp,
  });
  store.addMessage(input.conversationId, {
    id: input.assistantMessageId,
    role: 'assistant',
    content: '応答',
    timestamp: input.timestamp + 1,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
  });
  expect(
    store.transitionMessageMemoryPublication(input.conversationId, input.assistantMessageId, null)
      .status,
  ).toBe('applied');
  expect(
    store.transitionMessageMemoryPublication(
      input.conversationId,
      input.assistantMessageId,
      'enqueued',
    ).status,
  ).toBe('applied');
}

function seedTurnContribution(input: {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  taskId: string | null;
  now: number;
}): string {
  const subjectId = upsertEntity({
    name: `subject-${input.assistantMessageId}`,
    type: 'self',
    now: 1,
  }).id;
  return runMemoryTransaction(() =>
    recordFactWithContributionInTransaction(
      {
        subjectId,
        predicate: '颜色',
        objectText: 'أزرق',
        attributes: { turn: input.assistantMessageId },
        scope: input.taskId ? 'session' : 'global',
        sourceMessageId: input.userMessageId,
        sourceTurnId: input.assistantMessageId,
        now: input.now,
        ...(input.taskId
          ? {
              originConversationId: input.conversationId,
              originThreadId: input.conversationId,
              originTaskId: input.taskId,
            }
          : {}),
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
      {
        memoryConversationId: input.conversationId,
        sourceThreadId: input.conversationId,
        taskId: input.taskId,
        producer: {
          producerId: 'conversation_source_retirement_test',
          producerEventId: `event-${input.assistantMessageId}`,
        },
        sourceAliases: [
          { sourceKind: 'message', sourceId: input.userMessageId },
          { sourceKind: 'turn', sourceId: input.assistantMessageId },
        ],
      },
    ),
  ).result.fact.id;
}

function retire(input: {
  conversationId: string;
  messageId: string;
  reason?: ConversationRewindRetirementReason;
  now: number;
}) {
  return retireConversationSourcesForRewind({
    conversationId: input.conversationId,
    messageId: input.messageId,
    reason: input.reason ?? 'message_edit',
    now: input.now,
  });
}

describe('conversation source retirement before rewind', () => {
  it('seals an enqueued source before consolidation has produced a contribution', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublishedTurn({
      conversationId,
      userMessageId: 'user-queued',
      assistantMessageId: 'assistant-queued',
      timestamp: 10,
    });
    ensureFactSchema();
    expect(
      enqueueIngestionJob(
        withIngestionSourceSnapshot({
          threadId: conversationId,
          threadTitle: null,
          memoryConversationId: conversationId,
          personaId: 'default',
          taskId: 'task-queued',
          sourceStartMessageId: 'user-queued',
          sourceEndMessageId: 'assistant-queued',
          sourceRunId: null,
          sourceAt: 11,
          chatProviderId: null,
          chatModel: null,
          reason: 'turn_completed',
          providerEnrichment: false,
          now: 100,
        }),
      ),
    ).not.toBeNull();

    expect(retire({ conversationId, messageId: 'user-queued', now: 200 })).toEqual({
      status: 'retired',
      retiredSourceCount: 1,
    });
    expect(
      isMemorySourceWithdrawn({
        memoryConversationId: conversationId,
        sourceThreadId: conversationId,
        taskId: 'task-queued',
        sourceKind: 'turn',
        sourceId: 'assistant-queued',
      }),
    ).toBe(true);
  });

  it('retires the exact task-scoped source before allowing a fresh user identity', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublishedTurn({
      conversationId,
      userMessageId: 'user-original',
      assistantMessageId: 'assistant-original',
      timestamp: 10,
    });
    const factId = seedTurnContribution({
      conversationId,
      userMessageId: 'user-original',
      assistantMessageId: 'assistant-original',
      taskId: 'task-exact',
      now: 100,
    });

    expect(
      retire({
        conversationId,
        messageId: 'user-original',
        reason: 'message_retry',
        now: 200,
      }),
    ).toEqual({ status: 'retired', retiredSourceCount: 1 });
    expect(
      isMemorySourceWithdrawn({
        memoryConversationId: conversationId,
        sourceThreadId: conversationId,
        taskId: 'task-exact',
        sourceKind: 'message',
        sourceId: 'user-original',
      }),
    ).toBe(true);
    expect(
      getMemoryDb().getFirstSync<{ deleted_at: number }>(
        'SELECT deleted_at FROM memory_facts WHERE id = ? LIMIT 1',
        factId,
      ),
    ).toEqual({ deleted_at: 200 });

    const beforeRewind = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)!;
    expect(beforeRewind.messages[1]?.memoryPublication).toEqual({
      version: 1,
      disposition: 'withdrawn',
    });
    const rewind = useChatStore
      .getState()
      .rewindUserMessageForResend(conversationId, 'user-original', 'Revised request');
    expect(rewind.status).toBe('applied');
    if (rewind.status !== 'applied') throw new Error('expected rewind');
    expect(rewind.replacementMessageId).not.toBe('user-original');
  });

  it('retires every enqueued turn removed by an older-message edit in one operation', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublishedTurn({
      conversationId,
      userMessageId: 'user-first',
      assistantMessageId: 'assistant-first',
      timestamp: 10,
    });
    addPublishedTurn({
      conversationId,
      userMessageId: 'user-second',
      assistantMessageId: 'assistant-second',
      timestamp: 20,
    });
    const firstFactId = seedTurnContribution({
      conversationId,
      userMessageId: 'user-first',
      assistantMessageId: 'assistant-first',
      taskId: null,
      now: 100,
    });
    const secondFactId = seedTurnContribution({
      conversationId,
      userMessageId: 'user-second',
      assistantMessageId: 'assistant-second',
      taskId: null,
      now: 110,
    });

    expect(retire({ conversationId, messageId: 'user-first', now: 300 })).toEqual({
      status: 'retired',
      retiredSourceCount: 2,
    });
    expect(
      getMemoryDb().getAllSync<{ id: string; deleted_at: number }>(
        `SELECT id, deleted_at FROM memory_facts
          WHERE id IN (?, ?) ORDER BY id ASC`,
        firstFactId,
        secondFactId,
      ),
    ).toEqual([
      { id: firstFactId, deleted_at: 300 },
      { id: secondFactId, deleted_at: 300 },
    ]);
  });

  it('pages many source ids and retires more than one exact-tuple batch', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    runMemoryTransaction(() => {
      for (let turnIndex = 0; turnIndex < 130; turnIndex += 1) {
        const suffix = String(turnIndex).padStart(3, '0');
        addPublishedTurn({
          conversationId,
          userMessageId: `user-many-turns-${suffix}`,
          assistantMessageId: `assistant-many-turns-${suffix}`,
          timestamp: 10 + turnIndex * 2,
        });
        for (let taskIndex = 0; taskIndex < 2; taskIndex += 1) {
          seedTurnContribution({
            conversationId,
            userMessageId: `user-many-turns-${suffix}`,
            assistantMessageId: `assistant-many-turns-${suffix}`,
            taskId: `task-many-turns-${suffix}-${taskIndex}`,
            now: 100 + turnIndex * 2 + taskIndex,
          });
        }
      }
    });

    expect(retire({ conversationId, messageId: 'user-many-turns-000', now: 1_000 })).toEqual({
      status: 'retired',
      retiredSourceCount: 260,
    });
    const db = getMemoryDb();
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_source_retirement_groups',
      )?.count,
    ).toBe(2);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_facts WHERE deleted_at = 1000',
      )?.count,
    ).toBe(260);
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)?.messages[259]
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: 'withdrawn' });
  });

  it('advances the retirement clock to a future-dated selected contribution', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublishedTurn({
      conversationId,
      userMessageId: 'user-batch-rollback',
      assistantMessageId: 'assistant-batch-rollback',
      timestamp: 10,
    });
    runMemoryTransaction(() => {
      for (let index = 0; index < 257; index += 1) {
        seedTurnContribution({
          conversationId,
          userMessageId: 'user-batch-rollback',
          assistantMessageId: 'assistant-batch-rollback',
          taskId: `task-batch-rollback-${String(index).padStart(3, '0')}`,
          now: index === 256 ? 2_000 : 100 + index,
        });
      }
    });

    expect(retire({ conversationId, messageId: 'user-batch-rollback', now: 1_000 })).toEqual({
      status: 'retired',
      retiredSourceCount: 257,
    });
    const db = getMemoryDb();
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_source_retirement_groups',
      )?.count,
    ).toBe(2);
    expect(
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_retired_sources')
        ?.count,
    ).toBe(514);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT MAX(deleted_at) AS count FROM memory_facts WHERE deleted_at IS NOT NULL',
      )?.count,
    ).toBe(2_000);
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)?.messages[1]
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: 'withdrawn' });
  });

  it('rolls back an earlier coordinator batch when a later batch rejects', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublishedTurn({
      conversationId,
      userMessageId: 'user-atomic-rollback',
      assistantMessageId: 'assistant-atomic-rollback',
      timestamp: 10,
    });
    runMemoryTransaction(() => {
      for (let index = 0; index < 257; index += 1) {
        seedTurnContribution({
          conversationId,
          userMessageId: 'user-atomic-rollback',
          assistantMessageId: 'assistant-atomic-rollback',
          taskId: `task-atomic-rollback-${String(index).padStart(3, '0')}`,
          now: 100 + index,
        });
      }
    });

    const retireExactMemorySources = sourceRetirementCoordinator.retireExactMemorySources;
    const coordinatorSpy = jest.spyOn(sourceRetirementCoordinator, 'retireExactMemorySources');
    let callCount = 0;
    coordinatorSpy.mockImplementation((request) => {
      callCount += 1;
      if (callCount === 2) throw new Error('forced_second_batch_failure');
      return retireExactMemorySources(request);
    });
    try {
      expect(() =>
        retire({ conversationId, messageId: 'user-atomic-rollback', now: 1_000 }),
      ).toThrow('forced_second_batch_failure');
    } finally {
      coordinatorSpy.mockRestore();
    }

    const db = getMemoryDb();
    expect(callCount).toBe(2);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_source_retirement_groups',
      )?.count,
    ).toBe(0);
    expect(
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_retired_sources')
        ?.count,
    ).toBe(0);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_facts WHERE deleted_at IS NOT NULL',
      )?.count,
    ).toBe(0);
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)?.messages[1]
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: 'enqueued' });
  });

  it('fails closed when an enqueued receipt has no provable persisted source scope', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublishedTurn({
      conversationId,
      userMessageId: 'user-unresolved',
      assistantMessageId: 'assistant-unresolved',
      timestamp: 10,
    });

    expect(() => retire({ conversationId, messageId: 'user-unresolved', now: 200 })).toThrow(
      'conversation_rewind_memory_source_scope_unavailable',
    );
    const conversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId)!;
    expect(conversation.messages[1]?.memoryPublication).toEqual({
      version: 1,
      disposition: 'enqueued',
    });
    expect(() =>
      useChatStore
        .getState()
        .rewindUserMessageForResend(conversationId, 'user-unresolved', 'Replacement'),
    ).toThrow('chat_message_memory_publication_source_locked');
  });

  it('does not seal or replace a source while publication remains unresolved', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    const store = useChatStore.getState();
    store.addMessage(conversationId, {
      id: 'user-pending',
      role: 'user',
      content: '待处理',
      timestamp: 10,
    });
    store.addMessage(conversationId, {
      id: 'assistant-pending',
      role: 'assistant',
      content: 'قيد المعالجة',
      timestamp: 11,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    });
    expect(
      store.transitionMessageMemoryPublication(conversationId, 'assistant-pending', null).status,
    ).toBe('applied');

    expect(() => retire({ conversationId, messageId: 'user-pending', now: 200 })).toThrow(
      'conversation_rewind_memory_publication_pending',
    );
    ensureFactSchema();
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retired_sources',
      )?.count ?? 0,
    ).toBe(0);
  });
});
