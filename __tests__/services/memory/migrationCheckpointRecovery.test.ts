jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listFacts } from '../../../src/services/memory/facts/queries';
import { seedConversation } from '../../../src/services/memory/migrationSeedPass';
import {
  getMigrationState,
  MIGRATION_CLAIM_LEASE_MS,
} from '../../../src/services/memory/migrationStateStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Conversation } from '../../../src/types/conversation';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function buildConversation(): Conversation {
  return {
    id: 'per-turn-checkpoint',
    title: 'Per-turn checkpoint',
    messages: [
      { id: 'u-per-turn-checkpoint-0', role: 'user', content: 'Turn one', timestamp: 1 },
      { id: 'a-per-turn-checkpoint-0', role: 'assistant', content: 'Done one', timestamp: 2 },
      { id: 'u-per-turn-checkpoint-1', role: 'user', content: 'Turn two', timestamp: 3 },
      { id: 'a-per-turn-checkpoint-1', role: 'assistant', content: 'Done two', timestamp: 4 },
    ],
    createdAt: 1,
    updatedAt: 4,
    archivedFromMigration: true,
  } as Conversation;
}

function payload(predicate: string, value: string): string {
  return JSON.stringify({
    new_facts: [{ subject: 'user', predicate, value, confidence: 0.9 }],
    episode_summary: null,
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

it('does not re-extract a committed turn after recovery interrupts the next turn', async () => {
  const conversation = buildConversation();
  let releaseSecondTurn!: () => void;
  let notifySecondTurnStarted!: () => void;
  const secondTurnGate = new Promise<void>((resolve) => {
    releaseSecondTurn = resolve;
  });
  const secondTurnStarted = new Promise<void>((resolve) => {
    notifySecondTurnStarted = resolve;
  });
  let firstOwnerCall = 0;
  const firstOwnerExtractor = jest.fn(async () => {
    firstOwnerCall += 1;
    if (firstOwnerCall === 2) {
      notifySecondTurnStarted();
      await secondTurnGate;
    }
    return firstOwnerCall === 1
      ? payload('turn_one_checkpoint', 'original turn one')
      : payload('stale_turn_two', 'stale turn two');
  });
  const recoveredExtractor = jest.fn(async () =>
    payload('recovered_turn_two', 'recovered turn two'),
  );

  const firstOwner = seedConversation({
    conversation,
    extractor: firstOwnerExtractor,
    maxTurnsPerCall: 2,
    now: 40_000,
  });
  await secondTurnStarted;
  expect(getMigrationState(conversation.id)).toMatchObject({
    lastSeededMessageId: 'a-per-turn-checkpoint-0',
    seededTurns: 1,
    status: 'in_progress',
  });

  const recovered = await seedConversation({
    conversation,
    extractor: recoveredExtractor,
    maxTurnsPerCall: 2,
    now: 40_000 + MIGRATION_CLAIM_LEASE_MS,
  });
  releaseSecondTurn();
  const staleOwner = await firstOwner;

  expect(recovered).toMatchObject({ status: 'completed', seededTurns: 1 });
  expect(recoveredExtractor).toHaveBeenCalledTimes(1);
  expect(staleOwner).toMatchObject({ status: 'error', error: 'claim_lost' });
  const predicates = listFacts({ originConversationId: conversation.id }).map(
    (fact) => fact.predicate,
  );
  expect(predicates).toEqual(expect.arrayContaining(['turn_one_checkpoint', 'recovered_turn_two']));
  expect(predicates).not.toContain('stale_turn_two');
  expect(getMigrationState(conversation.id)).toMatchObject({
    lastSeededMessageId: 'a-per-turn-checkpoint-1',
    seededTurns: 2,
    status: 'completed',
  });
});
