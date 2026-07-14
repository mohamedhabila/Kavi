jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const messages: Message[] = [
  { id: 'user-fenced', role: 'user', content: 'Remember this.', timestamp: 1 },
  {
    id: 'assistant-fenced',
    role: 'assistant',
    content: 'Okay.',
    timestamp: 2,
    assistantMetadata: { kind: 'final', completionStatus: 'complete' },
  },
];

function validPayload(): string {
  return JSON.stringify({
    new_facts: [
      {
        version: 1,
        subject_ref: { kind: 'self' },
        predicate: 'prefers',
        value: 'this',
        scope: 'conversation',
        importance: 0.7,
        confidence: 0.9,
        source_message_id: 'user-fenced',
        operation: 'record',
        assertion_class: 'current_direct',
        evidence_quote: 'Remember this.',
        sensitivity: 'normal',
      },
    ],
    episode_summary: 'Must not persist.',
    active_focus: null,
    open_threads: [],
    notable: [],
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
});

function expectNoFencedWrites(threadId: string): void {
  expect(listEpisodes({ threadId })).toEqual([]);
  expect(listFacts({ originConversationId: threadId })).toEqual([]);
  expect(
    getMemoryDb().getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM memory_fact_contributions
        WHERE memory_conversation_id = ?`,
      threadId,
    )?.count,
  ).toBe(0);
}

it('keeps the pre-provider structural checkpoint but rejects enrichment after opt-out', async () => {
  const result = await processIngestionTurn({
    episodeAccess: { personaId: 'default', shareability: 'thread_only' },
    threadId: 'conv-opt-out-fence',
    messages,
    sourceEndMessageId: 'assistant-fenced',
    extractor: async () => {
      useSettingsStore.setState({ disableLongTermMemory: true } as never);
      return validPayload();
    },
  });

  expect(result).toEqual(expect.objectContaining({ processed: false, skipped: 'opt_out' }));
  expect(listEpisodes({ threadId: 'conv-opt-out-fence' })).toHaveLength(1);
  expect(listFacts({ originConversationId: 'conv-opt-out-fence' })).toEqual([]);
});

it('does not persist when the durable queue claim is no longer owned', async () => {
  const result = await processIngestionTurn({
    episodeAccess: { personaId: 'default', shareability: 'thread_only' },
    threadId: 'conv-claim-fence',
    messages,
    sourceEndMessageId: 'assistant-fenced',
    extractor: async () => validPayload(),
    canPersist: () => false,
  });

  expect(result).toEqual(expect.objectContaining({ processed: false, skipped: 'claim_lost' }));
  expectNoFencedWrites('conv-claim-fence');
});

it('rolls back every structural lane when the atomic checkpoint is rejected', async () => {
  const extractor = jest.fn(async () => validPayload());

  await expect(
    processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-checkpoint-fence',
      messages,
      sourceEndMessageId: 'assistant-fenced',
      extractor,
      canPersist: () => true,
      commitStructuralCheckpoint: () => false,
    }),
  ).rejects.toThrow('Memory structural checkpoint rejected');

  expect(extractor).not.toHaveBeenCalled();
  expectNoFencedWrites('conv-checkpoint-fence');
});
