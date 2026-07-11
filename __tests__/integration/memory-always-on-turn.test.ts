jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import { __resetIngestionQueueForTests } from '../../src/services/memory/ingestionQueue';
import { getWorkingBlock } from '../../src/services/memory/workingBlocks';
import { listEpisodes } from '../../src/services/memory/episodes/queries';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Message } from '../../src/types/message';
import { waitForIngestionJobTerminal } from '../helpers/ingestionQueueHarness';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function makeClosedTurn(userContent: string, assistantContent: string): Message[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      content: userContent,
      timestamp: 1,
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: assistantContent,
      timestamp: 2,
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
  __resetIngestionQueueForTests();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  __resetIngestionQueueForTests();
  closeMemoryDb();
});

describe('memory always-on turn integration', () => {
  it('records and asynchronously ingests chitchat and agentic turns', async () => {
    const chitchat = await recordCompletedTurnForMemory({
      threadId: 'conv-chit',
      messages: makeClosedTurn('hello', 'hi there'),
    });
    expect(chitchat.processed).toBe(true);
    expect(chitchat.enqueued).toBe(true);
    expect(chitchat.jobId).not.toBeNull();
    await expect(waitForIngestionJobTerminal(chitchat.jobId!)).resolves.toEqual(
      expect.objectContaining({ status: 'completed_structural' }),
    );

    const agentic = await recordCompletedTurnForMemory({
      threadId: 'conv-agent',
      messages: makeClosedTurn('search docs', 'Here are results [web_search]'),
    });
    expect(agentic.processed).toBe(true);
    expect(agentic.enqueued).toBe(true);
    expect(agentic.jobId).not.toBeNull();
    await expect(waitForIngestionJobTerminal(agentic.jobId!)).resolves.toEqual(
      expect.objectContaining({ status: 'completed_structural' }),
    );
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

    expect(recorded.jobId).not.toBeNull();
    await waitForIngestionJobTerminal(recorded.jobId!);
    expect(listEpisodes({ threadId: 'conv-sync' }).length).toBeGreaterThan(0);
  });
});
