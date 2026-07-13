jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { drainIngestionQueue } from '../../src/services/memory/ingestionQueue';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import { orchestrateMemoryRetrieval } from '../../src/services/memory/retrievalOrchestrator';
import { resolveLocalMemoryAccessScope } from '../../src/services/memory/memoryScopeStore';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Message } from '../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function closedAssistant(
  id: string,
  content: string,
  timestamp: number,
  toolCalls?: Message['toolCalls'],
): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    ...(toolCalls ? { toolCalls } : {}),
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

describe('memory three-turn recall fixture', () => {
  it('turn 3 retrieval can use structural facts written from turn 1', async () => {
    const threadId = 'conv-three-turn';
    const turn1: Message[] = [
      { id: 'u-1', role: 'user', content: 'Persist project metadata', timestamp: 1 },
      {
        id: 'a-tool-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
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
      { id: 'tool-1', role: 'tool', content: 'ok', timestamp: 3, toolCallId: 'tc-1' },
      closedAssistant('a-1', 'Saved project metadata.', 4),
    ];
    const turn2: Message[] = [
      ...turn1,
      { id: 'u-2', role: 'user', content: 'Continue setup', timestamp: 5 },
      closedAssistant('a-2', 'Setup continues.', 6),
    ];

    await recordCompletedTurnForMemory({
      threadId,
      messages: turn1,
      sourceEndMessageId: 'a-1',
      now: 10,
    });
    await drainIngestionQueue({ now: 10 });

    await recordCompletedTurnForMemory({
      threadId,
      messages: turn2,
      sourceEndMessageId: 'a-2',
      now: 20,
    });
    await drainIngestionQueue({ now: 20 });

    const retrieval = await orchestrateMemoryRetrieval({
      userMessage: 'Which atlas metadata file did we write?',
      memoryScope: resolveLocalMemoryAccessScope({
        memoryConversationId: threadId,
        sourceThreadId: threadId,
        personaId: 'default',
        taskId: null,
      }),
      limit: 6,
      now: 30,
    });

    const haystack = retrieval.facts
      .map((fact) => `${fact.predicate} ${fact.objectText}`)
      .join(' ')
      .toLowerCase();
    expect(haystack.includes('atlas')).toBe(true);
  });
});
