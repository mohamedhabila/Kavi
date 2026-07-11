jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { applyConsolidatorResult } from '../../../src/services/memory/consolidator';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => closeMemoryDb());

it('persists grounded and passive global facts without attaching conversation identity', () => {
  applyConsolidatorResult(
    {
      episodeSummary: null,
      newFacts: [
        {
          subject: 'user',
          predicate: 'preferred_tone',
          value: 'brief',
          scope: 'global',
          admittedWrite: {
            operation: 'insert',
            authority: 'grounded_user_statement',
            evidenceMessageId: 'user-1',
          },
        },
        {
          subject: 'user',
          predicate: 'possible_interest',
          value: 'jazz',
          scope: 'global',
          evidenceMessageIds: ['user-1'],
        },
      ],
      activeFocus: null,
      openThreads: [],
      notable: [],
    },
    {
      conversationId: 'conversation-1',
      threadId: 'thread-1',
      sourceUserMessageId: 'user-1',
      now: 100,
    },
  );

  const facts = listFacts({ scope: 'global' });
  expect(facts).toHaveLength(2);
  expect(
    facts.every(
      (fact) =>
        fact.originConversationId === null &&
        fact.originThreadId === null &&
        fact.originTaskId === null &&
        fact.personaId === null,
    ),
  ).toBe(true);
  expect(facts.find((fact) => fact.predicate === 'preferred_tone')).toMatchObject({
    factClass: 'subjective_user',
    sourceAuthority: 'grounded_user',
  });
  expect(facts.find((fact) => fact.predicate === 'possible_interest')).toMatchObject({
    factClass: 'subjective_user',
    sourceAuthority: 'assistant_inferred',
  });
});
