// ---------------------------------------------------------------------------
// Tests - useChatStore: clearChatHistory
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../../helpers/chatStoreHarness';
import { addConversation } from '../../helpers/chatConversationFixtures';
import { getMemoryDb } from '../../../src/services/memory/database';
import { publishConversationTurnMemory } from '../../../src/services/memory/core/memoryCapture';
import { addMemoryItem, listMemoryItems } from '../../../src/services/memory/core/memoryItemsStore';
import type { Message } from '../../../src/types/message';

function indexedTurnCount(): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_turns')
      ?.count ?? 0
  );
}

describe('useChatStore clearChatHistory', () => {
  it('removes the conversation and clears the active id', () => {
    addConversation('p1', 's');
    expect(useChatStore.getState().conversations).toHaveLength(1);

    useChatStore.getState().clearChatHistory();

    expect(useChatStore.getState().conversations).toEqual([]);
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });

  it('forgets what was said but keeps what Kavi remembers about the user', () => {
    const conversationId = addConversation('p1', 's');
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'I prefer window seats', timestamp: 10 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Noted, window seats.',
        timestamp: 11,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      },
    ];
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, messages } : conversation,
      ),
    }));
    publishConversationTurnMemory(conversationId, 'a1', useChatStore.getState().conversations);
    addMemoryItem({ text: 'Prefers window seats', conversationId, now: 12 });
    expect(indexedTurnCount()).toBe(1);

    useChatStore.getState().clearChatHistory();

    expect(indexedTurnCount()).toBe(0);
    expect(listMemoryItems({ limit: 10, offset: 0 }).map((item) => item.text)).toEqual([
      'Prefers window seats',
    ]);
  });
});
