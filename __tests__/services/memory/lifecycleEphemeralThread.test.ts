jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import { countPendingIngestionJobs } from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  recordCompletedTurnForMemory,
} from '../../../src/services/memory/lifecycle';
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
  __resetMemoryLifecycleForTests();
  __resetOnDeviceGuardsForTests();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  useChatStore.setState({ conversations: [], activeConversationId: null } as never);
});

afterEach(() => closeMemoryDb());

it('does not persist turns from an ephemeral side thread', async () => {
  const parentId = useChatStore.getState().createConversation('openai', 'system');
  const sideThreadId = useChatStore.getState().createSideThread(parentId)!;
  const messages: Message[] = [
    { id: 'side-user', role: 'user', content: 'Scratch this out.', timestamp: 1 },
    {
      id: 'side-assistant',
      role: 'assistant',
      content: 'Scratch work complete.',
      timestamp: 2,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    },
  ];
  for (const message of messages) useChatStore.getState().addMessage(sideThreadId, message);

  const result = await recordCompletedTurnForMemory({
    threadId: sideThreadId,
    memoryConversationId: parentId,
    messages,
    sourceEndMessageId: 'side-assistant',
    now: 10,
  });

  expect(result).toMatchObject({
    processed: false,
    enqueued: false,
    skipped: 'ephemeral_thread',
    jobId: null,
  });
  expect(countPendingIngestionJobs()).toBe(0);
});
