jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { __resetIngestionQueueForTests } from '../../src/services/memory/ingestionQueue';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import { getLatestReflection } from '../../src/services/memory/reflections';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Message } from '../../src/types/message';
import { waitForIngestionJobTerminal } from '../helpers/ingestionQueueHarness';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function closedAssistant(id: string, content: string, timestamp: number): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
  };
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

describe('reflection ingestion integration', () => {
  it('creates a daily_focus reflection after ingestion drain without blocking recall paths', async () => {
    const threadId = 'conv-reflection-ingest';
    const now = 1_700_000_000_000;
    const turn1: Message[] = [
      { id: 'u-1', role: 'user', content: 'Persist atlas metadata', timestamp: now },
      {
        id: 'a-tool-1',
        role: 'assistant',
        content: '',
        timestamp: now + 1,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'projects/atlas/metadata.json' }),
            status: 'completed',
          },
        ],
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      },
      { id: 'tool-1', role: 'tool', content: 'ok', timestamp: now + 2, toolCallId: 'tc-1' },
      closedAssistant('a-1', 'Saved atlas metadata.', now + 3),
    ];

    const recorded = await recordCompletedTurnForMemory({
      threadId,
      messages: turn1,
      sourceEndMessageId: 'a-1',
      now,
    });
    expect(recorded.jobId).not.toBeNull();
    await waitForIngestionJobTerminal(recorded.jobId!);

    const reflection = getLatestReflection({ threadId, kind: 'daily_focus' });
    expect(reflection).not.toBeNull();
    expect(reflection?.content.length).toBeGreaterThan(0);
  });
});
