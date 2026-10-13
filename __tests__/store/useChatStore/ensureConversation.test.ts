import { useChatStore } from '../../helpers/chatStoreHarness';
import { addConversation } from '../../helpers/chatConversationFixtures';

// Kavi is one conversation: whatever asks for it gets the same one.
describe('ensureConversation', () => {
  it('creates the conversation once and returns it to every later caller', () => {
    const first = useChatStore.getState().ensureConversation('openai', 'system', 'gpt-x', {
      mode: 'chitchat',
    });
    const second = useChatStore.getState().ensureConversation('openrouter', 'other', 'glm', {
      personaId: 'super-agent',
      mode: 'agentic',
    });

    expect(second).toBe(first);
    expect(useChatStore.getState().conversations).toHaveLength(1);
    expect(useChatStore.getState().conversations[0]).toMatchObject({
      id: first,
      providerId: 'openai',
      modelOverride: 'gpt-x',
      mode: 'chitchat',
    });
    expect(useChatStore.getState().activeConversationId).toBe(first);
  });

  it('returns the active conversation, else the most recently updated one', () => {
    const older = addConversation('openai', 'system', undefined, { activate: false });
    const newer = addConversation('openai', 'system', undefined, { activate: false });
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === newer
          ? { ...conversation, updatedAt: Date.now() + 1_000 }
          : conversation,
      ),
    }));

    expect(useChatStore.getState().ensureConversation('openai', 'system')).toBe(newer);

    useChatStore.getState().setActiveConversation(older);
    expect(useChatStore.getState().ensureConversation('openai', 'system')).toBe(older);
  });

  it('leaves the active conversation alone when asked not to activate', () => {
    const id = useChatStore
      .getState()
      .ensureConversation('openai', 'system', undefined, { activate: false });

    expect(useChatStore.getState().conversations.map((conversation) => conversation.id)).toEqual([
      id,
    ]);
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });
});
