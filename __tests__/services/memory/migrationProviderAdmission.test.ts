jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listFacts } from '../../../src/services/memory/facts/queries';
import { seedConversation } from '../../../src/services/memory/migrationSeedPass';
import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Conversation } from '../../../src/types/conversation';
import {
  currentUserSourceFromConsolidatorPrompt,
  semanticFactProposalJson,
} from '../../helpers/semanticFactProposalFixture';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  initializeMemoryPolicyObservation();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => closeMemoryDb());

it('never persists migration provider proposals that bypass exact source admission', async () => {
  const conversation = {
    id: 'proposal-bypass',
    title: 'Proposal bypass',
    messages: [
      { id: 'user-bypass', role: 'user', content: 'Remember cobalt.', timestamp: 1 },
      { id: 'assistant-bypass', role: 'assistant', content: 'Okay.', timestamp: 2 },
    ],
    archivedFromMigration: true,
  } as Conversation;
  const extractor = async (prompt: string) => {
    const source = currentUserSourceFromConsolidatorPrompt(prompt);
    return JSON.stringify({
      new_facts: [
        semanticFactProposalJson(source, {
          predicate: 'migration_memory',
          source_message_id: 'attacker-selected-source',
        }),
      ],
      episode_sensitivity: 'normal',
      episode_summary: null,
      active_focus: null,
      open_threads: [],
      notable: [],
    });
  };

  const result = await seedConversation({ conversation, extractor });

  expect(result).toMatchObject({ status: 'completed', seededTurns: 1 });
  expect(result.results[0]?.newFacts).toEqual([]);
  expect(listFacts({ originConversationId: conversation.id })).toEqual([]);
});
