import {
  filterConversationsByTitle,
  getNavigableConversations,
} from '../../src/utils/conversationNavigation';
import type { Conversation } from '../../src/types/conversation';

function conversation(
  id: string,
  updatedAt: number,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    title: id,
    messages: [],
    providerId: 'openrouter',
    systemPrompt: '',
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

describe('conversation navigation', () => {
  it('sorts real conversations by activity and omits migration-only archives', () => {
    const result = getNavigableConversations([
      conversation('older', 10),
      conversation('archived', 30, { archivedFromMigration: true }),
      conversation('side', 20, { isSideThread: true, parentConversationId: 'older' }),
    ]);

    expect(result.map((item) => item.id)).toEqual(['side', 'older']);
  });

  it('preserves store order when activity timestamps match', () => {
    const result = getNavigableConversations([
      conversation('first', 10),
      conversation('second', 10),
    ]);

    expect(result.map((item) => item.id)).toEqual(['first', 'second']);
  });

  it('filters titles case-insensitively without mutating the source list', () => {
    const source = [
      conversation('one', 20, { title: 'Plan Summer Trip' }),
      conversation('two', 10, { title: 'Grocery list' }),
    ];

    expect(filterConversationsByTitle(source, '  summer ')).toEqual([source[0]]);
    expect(source.map((item) => item.id)).toEqual(['one', 'two']);
  });
});
