jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const priorTurn: Message[] = [
  { id: 'user-prior', role: 'user', content: 'My default is 30 minutes.', timestamp: 1 },
  {
    id: 'assistant-prior',
    role: 'assistant',
    content: 'Understood.',
    timestamp: 2,
    assistantMetadata: { kind: 'final', completionStatus: 'complete' },
  },
];
const currentTurn: Message[] = [
  { id: 'user-current', role: 'user', content: 'Change it to 45 minutes.', timestamp: 3 },
  {
    id: 'assistant-current',
    role: 'assistant',
    content: 'Done.',
    timestamp: 4,
    assistantMetadata: { kind: 'final', completionStatus: 'complete' },
  },
];

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => closeMemoryDb());

function expectNoWrites(threadId: string): void {
  expect(listEpisodes({ threadId })).toEqual([]);
  expect(listFacts({ originConversationId: threadId })).toEqual([]);
}

it.each([
  ['does not match the derived prior', 'other-prior', [...priorTurn, ...currentTurn]],
  [
    'is ambiguous in provenance history',
    'user-prior',
    [priorTurn[0]!, { ...priorTurn[0]! }, priorTurn[1]!, ...currentTurn],
  ],
])('fails closed before persistence when the sealed prior %s', async (_label, sealed, history) => {
  const threadId = `identity-invalid-${sealed}`;
  const result = await processIngestionTurn({
    episodeAccess: { personaId: 'default', shareability: 'thread_only' },
    threadId,
    messages: currentTurn,
    sealedPriorUserMessageId: sealed,
    priorIdentityMessages: history,
  });

  expect(result).toMatchObject({ processed: false, skipped: 'source_identity_invalid' });
  expectNoWrites(threadId);
});

it('accepts an exact unique sealed prior without widening the persisted turn', async () => {
  const threadId = 'identity-exact-prior';
  const result = await processIngestionTurn({
    episodeAccess: { personaId: 'default', shareability: 'thread_only' },
    threadId,
    messages: currentTurn,
    sealedPriorUserMessageId: 'user-prior',
    priorIdentityMessages: [...priorTurn, ...currentTurn],
  });

  expect(result.processed).toBe(true);
  expect(listEpisodes({ threadId })).toHaveLength(1);
});
