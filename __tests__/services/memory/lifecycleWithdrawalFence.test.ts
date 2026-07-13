jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  __resetIngestionQueueForTests,
  countPendingIngestionJobs,
} from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  recordCompletedTurnForMemory,
} from '../../../src/services/memory/lifecycle';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { messages } from '../../helpers/memoryLifecycle';
import { insertRetiredMemorySourceForTest } from '../../helpers/memoryWithdrawalFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetMemoryLifecycleForTests();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({ disableLongTermMemory: false, providers: [] } as any);
  useChatStore.setState({ conversations: [] } as any);
});

afterEach(() => {
  closeMemoryDb();
});

describe('memory lifecycle withdrawal fence', () => {
  it('fences a withdrawn exact turn before any working-memory mutation', async () => {
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'withdrawal-lifecycle',
      memoryConversationId: 'conv-withdrawn',
      sourceThreadId: 'conv-withdrawn',
      sourceKind: 'turn',
      sourceId: 'a-1',
    });

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-withdrawn',
      threadTitle: 'Must remain withdrawn',
      messages,
      sourceEndMessageId: 'a-1',
      now: 10,
    });

    expect(result).toMatchObject({
      processed: false,
      enqueued: false,
      skipped: 'withdrawn',
      activeFocusUpdated: false,
      openThreadsUpdated: false,
    });
    expect(countPendingIngestionJobs()).toBe(0);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-withdrawn',
        threadId: 'conv-withdrawn',
      }),
    ).toBeNull();
  });
});
