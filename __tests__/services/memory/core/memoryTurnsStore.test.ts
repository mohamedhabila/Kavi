jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../../src/services/memory/database';
import {
  MEMORY_TURN_TEXT_MAX_CHARS,
  resetMemoryCoreSchemaCacheForTests,
} from '../../../../src/services/memory/core/memorySchema';
import { memoryTextLength } from '../../../../src/services/memory/core/memoryText';
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

    expect(
      searchMemoryTurns({ query: 'that Lisbon weekend plan', limit: 3, includeSensitive: false }),
    ).toEqual([
      {
        userMessageId: 'u1',
        conversationId: 'conv-1',
        at: 10,
        text: 'User: Plan a weekend in Lisbon with my partner\nAssistant: Here is a two-day plan...',
        sensitive: false,
      },
    ]);
  });

  it('can leave the current conversation out', () => {
    turn('conv-1', 'u1', 'Lisbon trip ideas', 'Sintra and Belém.');

    expect(
      searchMemoryTurns({
        query: 'Lisbon trip',
        limit: 3,
        includeSensitive: false,
        excludeConversationId: 'conv-1',
      }),
    ).toEqual([]);
  });

  it('re-indexes a round when its reply changes', () => {
    turn('conv-1', 'u1', 'Lisbon trip ideas', 'Draft reply.');
    turn('conv-1', 'u1', 'Lisbon trip ideas', 'Final reply about Sintra.');

    expect(
      searchMemoryTurns({ query: 'Sintra', limit: 3, includeSensitive: false }).map(
        (found) => found.text,
      ),
    ).toEqual(['User: Lisbon trip ideas\nAssistant: Final reply about Sintra.']);
    expect(searchMemoryTurns({ query: 'Draft', limit: 3, includeSensitive: false })).toEqual([]);
  });

  it('skips an empty round and deletes with its conversation', () => {
    expect(turn('conv-1', 'u0', '  ', '')).toBe(false);
    turn('conv-1', 'u1', 'Lisbon trip ideas', 'Sintra.');

    expect(deleteMemoryTurnsFromConversation('conv-1')).toBe(1);
    expect(searchMemoryTurns({ query: 'Lisbon', limit: 3, includeSensitive: false })).toEqual([]);
  });
});

describe('past turn privacy', () => {
  it('never indexes a round that carries a credential, even on re-index', () => {
    turn('conv-1', 'u1', 'Deploy notes for Lisbon', 'Done.');
    expect(turn('conv-1', 'u1', 'Deploy notes for Lisbon', `Use sk-proj-${'c'.repeat(24)}`)).toBe(
      false,
    );

    expect(searchMemoryTurns({ query: 'Lisbon', limit: 3, includeSensitive: true })).toEqual([]);
  });

  it('returns a round with personal data only to an explicit search', () => {
    turn('conv-1', 'u1', 'Email Sara at sara@example.com about Lisbon', 'Drafted.');

    expect(searchMemoryTurns({ query: 'Lisbon', limit: 3, includeSensitive: false })).toEqual([]);
    expect(
      searchMemoryTurns({ query: 'Lisbon', limit: 3, includeSensitive: true }).map(
        (found) => found.sensitive,
      ),
    ).toEqual([true]);
  });
});

describe('past turn size', () => {
  it('fits a long round into the stored bound without splitting a grapheme', () => {
    const family = '👨‍👩‍👧‍👦';

    expect(turn('conv-1', 'u1', `Lisbon ${family.repeat(1_000)}`, 'Noted.')).toBe(true);

    const [stored] = searchMemoryTurns({ query: 'Lisbon', limit: 1, includeSensitive: true });
    expect(memoryTextLength(stored!.text)).toBeLessThanOrEqual(MEMORY_TURN_TEXT_MAX_CHARS);
    expect(stored!.text.endsWith(`${family}…`)).toBe(true);
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

    expect(searchMemoryTurns({ query: 'Sintra', limit: 3, includeSensitive: false })).toEqual([
      {
        userMessageId: 'u2',
        conversationId: 'conv-1',
        at: 7,
        text: 'User: Plan a weekend in Lisbon\nInclude a day in Sintra\nAssistant: Day one Alfama, day two Sintra.',
        sensitive: false,
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
