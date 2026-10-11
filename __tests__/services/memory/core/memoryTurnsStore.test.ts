jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../../../src/services/memory/core/memorySchema';
import {
  deleteMemoryTurnsFromConversation,
  indexClosedTurn,
  indexMemoryTurn,
  searchMemoryTurns,
} from '../../../../src/services/memory/core/memoryTurnsStore';
import type { Message } from '../../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function turn(
  conversationId: string,
  userMessageId: string,
  userText: string,
  replyText: string,
  at = 1,
) {
  return indexMemoryTurn({ conversationId, userMessageId, userText, replyText, at });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('past turns', () => {
  it('recalls an earlier conversation round by what was discussed', () => {
    turn(
      'conv-1',
      'u1',
      'Plan a weekend in Lisbon with my partner',
      'Here is a two-day plan...',
      10,
    );
    turn('conv-2', 'u2', 'What should I cook tonight?', 'Try a mushroom risotto.', 20);

    expect(searchMemoryTurns({ query: 'that Lisbon weekend plan', limit: 3 })).toEqual([
      {
        userMessageId: 'u1',
        conversationId: 'conv-1',
        at: 10,
        text: 'User: Plan a weekend in Lisbon with my partner\nAssistant: Here is a two-day plan...',
      },
    ]);
  });

  it('can leave the current conversation out', () => {
    turn('conv-1', 'u1', 'Lisbon trip ideas', 'Sintra and Belém.');

    expect(
      searchMemoryTurns({ query: 'Lisbon trip', limit: 3, excludeConversationId: 'conv-1' }),
    ).toEqual([]);
  });

  it('re-indexes a round when its reply changes', () => {
    turn('conv-1', 'u1', 'Lisbon trip ideas', 'Draft reply.');
    turn('conv-1', 'u1', 'Lisbon trip ideas', 'Final reply about Sintra.');

    expect(searchMemoryTurns({ query: 'Sintra', limit: 3 }).map((found) => found.text)).toEqual([
      'User: Lisbon trip ideas\nAssistant: Final reply about Sintra.',
    ]);
    expect(searchMemoryTurns({ query: 'Draft', limit: 3 })).toEqual([]);
  });

  it('skips an empty round and deletes with its conversation', () => {
    expect(turn('conv-1', 'u0', '  ', '')).toBe(false);
    turn('conv-1', 'u1', 'Lisbon trip ideas', 'Sintra.');

    expect(deleteMemoryTurnsFromConversation('conv-1')).toBe(1);
    expect(searchMemoryTurns({ query: 'Lisbon', limit: 3 })).toEqual([]);
  });
});

describe('closed turn indexing', () => {
  const steeredTurn: Message[] = [
    { id: 'u1', role: 'user', content: 'Book a table for Friday', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: 'Booked at Nola for 8pm.', timestamp: 2 },
    { id: 'u2', role: 'user', content: 'Plan a weekend in Lisbon', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: '', timestamp: 4 },
    { id: 't2', role: 'tool', content: '{"results":[]}', timestamp: 5 },
    {
      id: 'u3',
      role: 'user',
      content: 'Include a day in Sintra',
      steerOfRunId: 'run-2',
      timestamp: 6,
    },
    { id: 'a3', role: 'assistant', content: 'Day one Alfama, day two Sintra.', timestamp: 7 },
  ];

  it('indexes the opening request, its steering messages and the final reply', () => {
    expect(
      indexClosedTurn({ conversationId: 'conv-1', messages: steeredTurn, replyMessageId: 'a3' }),
    ).toBe(true);

    expect(searchMemoryTurns({ query: 'Sintra', limit: 3 })).toEqual([
      {
        userMessageId: 'u2',
        conversationId: 'conv-1',
        at: 7,
        text: 'User: Plan a weekend in Lisbon\nInclude a day in Sintra\nAssistant: Day one Alfama, day two Sintra.',
      },
    ]);
  });

  it('ignores a reply it cannot find or one no user message opened', () => {
    expect(
      indexClosedTurn({ conversationId: 'conv-1', messages: steeredTurn, replyMessageId: 'gone' }),
    ).toBe(false);
    expect(
      indexClosedTurn({
        conversationId: 'conv-1',
        messages: [{ id: 'a0', role: 'assistant', content: 'Hello!', timestamp: 1 }],
        replyMessageId: 'a0',
      }),
    ).toBe(false);
  });
});
