jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import { __resetIngestionQueueForTests } from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  recordCompletedTurnForMemory,
} from '../../../src/services/memory/lifecycle';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { messages } from '../../helpers/memoryLifecycle';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetMemoryLifecycleForTests();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    consolidationProvider: '',
    providers: [],
  } as any);
  useChatStore.setState({ conversations: [] } as any);
});

afterEach(() => {
  closeMemoryDb();
});

describe('memory lifecycle without semantic projection', () => {
  it('does not project conversation focus without an exact closed turn', async () => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-title-only',
      threadTitle: 'longmem-delayed-thread',
      messages: [
        {
          id: 'u-1',
          role: 'user',
          content: 'Verify stored state later.',
          timestamp: 1,
        },
        {
          id: 'a-incomplete',
          role: 'assistant',
          content: '',
          timestamp: 2,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'response_failed',
          },
        },
      ],
      sourceEndMessageId: 'a-incomplete',
      now: 10,
    });

    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('no_closed_turn');
    expect(result.activeFocusUpdated).toBe(false);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-title-only',
        threadId: 'conv-title-only',
      }),
    ).toBeNull();
  });

  it('does not synthesize conversation or task focus without provider semantics', async () => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-task-focus',
      threadTitle: 'thread-focus-anchor',
      taskId: 'goal-1',
      messages,
      sourceEndMessageId: 'a-1',
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.activeFocusUpdated).toBe(false);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-task-focus',
        threadId: 'conv-task-focus',
      }),
    ).toBeNull();
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-task-focus',
        threadId: 'conv-task-focus',
        taskId: 'goal-1',
      }),
    ).toBeNull();
  });
});
