jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../../helpers/chatStoreHarness';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../../src/services/memory/core/memorySchema';
import {
  indexClosedTurn,
  searchMemoryTurns,
} from '../../../src/services/memory/core/memoryTurnsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function indexedTurnIds(query: string): string[] {
  return searchMemoryTurns({ query, limit: 10, includeSensitive: true }).map(
    (turn) => turn.userMessageId,
  );
}

function closeTurn(conversationId: string, replyMessageId: string): void {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId)!;
  expect(indexClosedTurn({ conversationId, messages: conversation.messages, replyMessageId })).toBe(
    true,
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('rewinding a user message for resend', () => {
  it('removes the rewound turns from the past-turn index and keeps earlier ones', () => {
    const store = useChatStore.getState();
    const conversationId = store.createConversation('p1', 's');
    store.addMessage(conversationId, {
      id: 'kept-user',
      role: 'user',
      content: 'Remind me which marmalade recipe I liked',
      timestamp: 1,
    });
    store.addMessage(conversationId, {
      id: 'kept-reply',
      role: 'assistant',
      content: 'The Seville marmalade with less sugar.',
      timestamp: 2,
    });
    closeTurn(conversationId, 'kept-reply');
    store.addMessage(conversationId, {
      id: 'rewound-user',
      role: 'user',
      content: 'Plan a marmalade tasting for Saturday',
      timestamp: 3,
    });
    store.addMessage(conversationId, {
      id: 'rewound-reply',
      role: 'assistant',
      content: 'Saturday marmalade tasting plan.',
      timestamp: 4,
    });
    closeTurn(conversationId, 'rewound-reply');
    expect(indexedTurnIds('marmalade').sort()).toEqual(['kept-user', 'rewound-user']);

    const replacement = store.rewindUserMessageForResend(
      conversationId,
      'rewound-user',
      'Plan a marmalade tasting for Sunday',
    );

    expect(replacement.status).toBe('applied');
    expect(indexedTurnIds('marmalade')).toEqual(['kept-user']);
  });
});
