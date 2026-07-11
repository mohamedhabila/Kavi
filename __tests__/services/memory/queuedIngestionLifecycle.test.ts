jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import type { Message } from '../../../src/types/message';

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
  });
  enqueueIngestionJob({
    personaId: 'default',
    threadId,
    threadTitle: null,
    memoryConversationId: threadId,
    taskId: null,
    sourceStartMessageId: 'u-window-2',
    sourceEndMessageId: 'a-window-2',
    sourceRunId: null,
    sourceAt: 20,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 20,
  });

  const result = await drainIngestionQueue({ loadMessagesForThread: () => transcript });

  expect(result).toEqual({
    attempted: 2,
    completed: 2,
    completedStructural: 2,
    completedEnriched: 0,
    retrying: 0,
    degraded: 0,
    deferred: 0,
    sourceDeferred: 0,
    resourceDeferred: 0,
    failed: 0,
  });
  expect(
    listEpisodes({ threadId }).map((episode) => ({
      messageIds: episode.messageIds,
      summary: episode.summary,
    })),
  ).toEqual([
    { messageIds: ['u-window-2', 'a-window-2'], summary: 'Second queued turn.' },
    { messageIds: ['u-window-1', 'a-window-1'], summary: 'First queued turn.' },
  ]);
  expect(getConsolidationState(threadId)?.lastConsolidatedMessageId).toBe('a-window-2');
});
