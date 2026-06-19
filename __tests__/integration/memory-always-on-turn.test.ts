jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import {
  drainIngestionQueue,
  listPendingIngestionJobs,
} from '../../src/services/memory/ingestionQueue';
import { getWorkingBlock } from '../../src/services/memory/workingBlocks';
import { listEpisodes } from '../../src/services/memory/episodes/queries';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Message } from '../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function makeClosedTurn(userContent: string, assistantContent: string): Message[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      content: userContent,
      createdAt: 1,
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: assistantContent,
      createdAt: 2,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  closeMemoryDb();
});

describe('memory always-on turn integration', () => {
  it('enqueues ingestion for chitchat and agentic turns without blocking', async () => {
    const chitchat = await recordCompletedTurnForMemory({
      threadId: 'conv-chit',
      messages: makeClosedTurn('hello', 'hi there'),
    });
    expect(chitchat.processed).toBe(true);
    expect(chitchat.enqueued).toBe(true);
    expect(listPendingIngestionJobs()).toHaveLength(1);

    const agentic = await recordCompletedTurnForMemory({
      threadId: 'conv-agent',
      messages: makeClosedTurn('search docs', 'Here are results [web_search]'),
    });
    expect(agentic.processed).toBe(true);
    expect(agentic.enqueued).toBe(true);
  });

  it('updates working memory synchronously before queue drain', async () => {
    const messages = makeClosedTurn('plan trip', 'Working on itinerary');
    const recorded = await recordCompletedTurnForMemory({
      threadId: 'conv-sync',
      threadTitle: 'Trip planning',
      messages,
    });

    expect(recorded.processed).toBe(true);
    expect(recorded.enqueued).toBe(true);

    const focus = getWorkingBlock('active_focus', {
      conversationId: 'conv-sync',
      threadId: 'conv-sync',
    });
    expect((focus?.content ?? '').length).toBeGreaterThan(0);

    await drainIngestionQueue({
      loadMessagesForThread: () => messages,
    });
    expect(listEpisodes({ threadId: 'conv-sync' }).length).toBeGreaterThan(0);
  });
});
