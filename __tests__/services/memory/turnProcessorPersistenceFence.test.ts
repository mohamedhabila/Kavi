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
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
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
        subject: 'user',
        predicate: 'prefers',
        value: 'quiet mornings',
        confidence: 0.9,
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
}

it('does not persist when the user opts out during provider enrichment', async () => {
  const result = await processIngestionTurn({
    threadId: 'conv-opt-out-fence',
    messages,
    extractor: async () => {
      useSettingsStore.setState({ disableLongTermMemory: true } as never);
      return validPayload();
    },
  });

  expect(result).toEqual(expect.objectContaining({ processed: false, skipped: 'opt_out' }));
  expectNoFencedWrites('conv-opt-out-fence');
});

it('does not persist when the durable queue claim is no longer owned', async () => {
  const result = await processIngestionTurn({
    threadId: 'conv-claim-fence',
    messages,
    extractor: async () => validPayload(),
    canPersist: () => false,
  });

  expect(result).toEqual(expect.objectContaining({ processed: false, skipped: 'claim_lost' }));
  expectNoFencedWrites('conv-claim-fence');
});
