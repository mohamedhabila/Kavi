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

import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob,
  getIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import * as ingestionSourceSnapshotCodec from '../../../src/services/memory/ingestionSourceSnapshot';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({ disableLongTermMemory: false, providers: [] } as never);
  useChatStore.setState({ conversations: [] } as never);
});

afterEach(() => {
  __resetIngestionQueueForTests();
  jest.restoreAllMocks();
  closeMemoryDb();
});

it('processes the immutable turn after restart even when live chat is deleted', async () => {
  const messages: Message[] = [
    {
      id: 'user-durable-source',
      role: 'user',
      content: 'Retain durable source token ORBIT-742.',
      timestamp: 1,
    },
    {
      id: 'assistant-durable-source',
      role: 'assistant',
      content: 'I retained the durable source token.',
      timestamp: 2,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
  useChatStore.setState({
    conversations: [
      {
        id: 'thread-durable-source',
        title: 'Durable source',
        messages,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  } as never);
  const job = enqueueIngestionJob({
    personaId: 'default',
    threadId: 'thread-durable-source',
    threadTitle: 'Durable source',
    memoryConversationId: 'thread-durable-source',
    taskId: null,
    sourceStartMessageId: 'user-durable-source',
    sourceEndMessageId: 'assistant-durable-source',
    sourceRunId: null,
    sourceAt: 2,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: false,
    now: 2,
    sourceSnapshot: encodeIngestionSourceSnapshot({
      messages,
      priorUserMessageId: null,
      sourceStartMessageId: 'user-durable-source',
      sourceEndMessageId: 'assistant-durable-source',
    }),
  })!;

  messages[0]!.content = 'Compacted replacement that must not be ingested.';
  useChatStore.setState({ conversations: [] } as never);
  closeMemoryDb();
  resetFactSchemaCacheForTests();
  ensureFactSchema();

  await expect(drainIngestionQueue({ now: 3 })).resolves.toMatchObject({
    attempted: 1,
    completedStructural: 1,
    failed: 0,
  });

  expect(getIngestionJob(job.id)).toMatchObject({
    status: 'completed_structural',
    outcomeCode: null,
  });
  expect(listEpisodes({ threadId: 'thread-durable-source' })).toEqual([
    expect.objectContaining({
      messageIds: ['user-durable-source', 'assistant-durable-source'],
      summary: JSON.stringify({
        kind: 'structural_turn',
        version: 1,
        messageCount: 2,
        toolCallCount: 0,
        completedToolCallCount: 0,
        hasCodeBlock: false,
        hasAttachments: false,
      }),
    }),
  ]);
  expect(
    getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_ingestion_source_snapshots WHERE job_id = ?',
      job.id,
    )?.count,
  ).toBe(0);
});

it('performs one full snapshot decode for one claimed processing attempt', async () => {
  const messages: Message[] = [
    {
      id: 'user-single-decode',
      role: 'user',
      content: 'Remember one decode.',
      timestamp: 1,
    },
    {
      id: 'assistant-single-decode',
      role: 'assistant',
      content: 'Done.',
      timestamp: 2,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
  const sourceSnapshot = encodeIngestionSourceSnapshot({
    messages,
    priorUserMessageId: null,
    sourceStartMessageId: 'user-single-decode',
    sourceEndMessageId: 'assistant-single-decode',
  });
  enqueueIngestionJob({
    personaId: 'default',
    threadId: 'thread-single-decode',
    threadTitle: null,
    memoryConversationId: 'thread-single-decode',
    taskId: null,
    sourceStartMessageId: 'user-single-decode',
    sourceEndMessageId: 'assistant-single-decode',
    sourceRunId: null,
    sourceAt: 2,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: false,
    now: 2,
    sourceSnapshot,
  });
  const decodeSpy = jest.spyOn(ingestionSourceSnapshotCodec, 'decodeIngestionSourceSnapshot');

  await expect(drainIngestionQueue({ now: 3 })).resolves.toMatchObject({
    attempted: 1,
    completedStructural: 1,
  });

  expect(decodeSpy).toHaveBeenCalledTimes(1);
});
