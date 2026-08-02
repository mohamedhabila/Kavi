import { partializeChatPersistState } from '../../src/store/chatPersistence';
import { makeTestConversation as makeConversation } from '../helpers/factories';

describe('chat persistence projection cache', () => {
  it('reuses sanitized projections for unchanged immutable conversations', () => {
    const unchanged = makeConversation({ id: 'unchanged-conversation' });
    const changing = makeConversation({ id: 'changing-conversation' });
    const first = partializeChatPersistState({
      conversations: [unchanged, changing],
      activeConversationId: changing.id,
    });
    const updatedChanging = { ...changing, title: 'Updated title' };
    const second = partializeChatPersistState({
      conversations: [unchanged, updatedChanging],
      activeConversationId: updatedChanging.id,
    });

    expect(second.conversations[0]).toBe(first.conversations[0]);
    expect(second.conversations[1]).not.toBe(first.conversations[1]);
    expect(second.conversations[1].title).toBe('Updated title');
  });
});
