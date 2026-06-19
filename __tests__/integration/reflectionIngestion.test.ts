jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { drainIngestionQueue } from '../../src/services/memory/ingestionQueue';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import { getLatestReflection } from '../../src/services/memory/reflections';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Message } from '../../src/types/message';

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
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  closeMemoryDb();
});

describe('reflection ingestion integration', () => {
  it('creates a daily_focus reflection after ingestion drain without blocking recall paths', async () => {
    const threadId = 'conv-reflection-ingest';
    const now = 1_700_000_000_000;
    const turn1: Message[] = [
      { id: 'u-1', role: 'user', content: 'Persist atlas metadata', timestamp: now },
      closedAssistant('a-1', 'Saved atlas metadata.', now + 1),
    ];

    await recordCompletedTurnForMemory({ threadId, messages: turn1, now });
    await drainIngestionQueue({ loadMessagesForThread: () => turn1, now });

    const reflection = getLatestReflection({ threadId, kind: 'daily_focus' });
    expect(reflection).not.toBeNull();
    expect(reflection?.content.length).toBeGreaterThan(0);
  });
});
