jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob as enqueueStrictIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import type { Message } from '../../../src/types/message';
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
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

it('consolidates each queued turn from its recorded source window', async () => {
  const threadId = 'conv-queued-windows';
  const transcript: Message[] = [
    { id: 'u-window-1', role: 'user', content: 'First queued turn.', timestamp: 1 },
    {
      id: 'a-window-1',
      role: 'assistant',
      content: 'First response.',
      timestamp: 2,
      assistantMetadata: { kind: 'final', completionStatus: 'complete' },
    },
    { id: 'u-window-2', role: 'user', content: 'Second queued turn.', timestamp: 3 },
    {
      id: 'a-window-2',
      role: 'assistant',
      content: 'Second response.',
      timestamp: 4,
      assistantMetadata: { kind: 'final', completionStatus: 'complete' },
    },
  ];

  enqueueIngestionJob({
    personaId: 'default',
    threadId,
    threadTitle: null,
    memoryConversationId: threadId,
    taskId: null,
    sourceStartMessageId: 'u-window-1',
    sourceEndMessageId: 'a-window-1',
    sourceRunId: null,
    sourceAt: 10,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 10,
    sourceSnapshot: encodeIngestionSourceSnapshot({
      messages: transcript,
      priorUserMessageId: null,
      sourceStartMessageId: 'u-window-1',
      sourceEndMessageId: 'a-window-1',
    }),
  });
  enqueueIngestionJob({
    personaId: 'default',
    threadId,
    threadTitle: null,
    memoryConversationId: threadId,
    taskId: null,
    priorUserMessageId: 'u-window-1',
    sourceStartMessageId: 'u-window-2',
    sourceEndMessageId: 'a-window-2',
    sourceRunId: null,
    sourceAt: 20,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 20,
    sourceSnapshot: encodeIngestionSourceSnapshot({
      messages: transcript,
      priorUserMessageId: 'u-window-1',
      sourceStartMessageId: 'u-window-2',
      sourceEndMessageId: 'a-window-2',
    }),
  });

  const firstResult = await drainIngestionQueue({});
  const secondResult = await drainIngestionQueue({});

  expect([firstResult, secondResult]).toEqual([
    {
      attempted: 1,
      completed: 1,
      completedStructural: 1,
      completedEnriched: 0,
      retrying: 0,
      degraded: 0,
      deferred: 0,
      resourceDeferred: 0,
      failed: 0,
    },
    {
      attempted: 1,
      completed: 1,
      completedStructural: 1,
      completedEnriched: 0,
      retrying: 0,
      degraded: 0,
      deferred: 0,
      resourceDeferred: 0,
      failed: 0,
    },
  ]);
  expect(
    listEpisodes({ threadId }).map((episode) => ({
      messageIds: episode.messageIds,
      summary: episode.summary,
    })),
  ).toEqual([
    {
      messageIds: ['u-window-2', 'a-window-2'],
      summary: JSON.stringify({
        kind: 'structural_turn',
        version: 1,
        messageCount: 2,
        toolCallCount: 0,
        completedToolCallCount: 0,
        hasCodeBlock: false,
        hasAttachments: false,
      }),
    },
    {
      messageIds: ['u-window-1', 'a-window-1'],
      summary: JSON.stringify({
        kind: 'structural_turn',
        version: 1,
        messageCount: 2,
        toolCallCount: 0,
        completedToolCallCount: 0,
        hasCodeBlock: false,
        hasAttachments: false,
      }),
    },
  ]);
  expect(getConsolidationState(threadId)?.lastConsolidatedMessageId).toBe('a-window-2');
});
