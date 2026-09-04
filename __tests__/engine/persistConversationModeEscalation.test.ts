import { persistConversationModeEscalation } from '../../src/engine/graph/conversation/persistModeEscalation';
import { useChatStore } from '../../src/store/useChatStore';

function findConversation(conversationId: string) {
  return useChatStore.getState().conversations.find((entry) => entry.id === conversationId);
}

describe('persistConversationModeEscalation', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  function seedChitchatConversation(): string {
    const conversationId = useChatStore
      .getState()
      .createConversation('openai', 'system', undefined, {
        personaId: 'default',
        mode: 'chitchat',
      });
    useChatStore.getState().addMessage(conversationId, {
      id: 'user-1',
      role: 'user',
      content: "what's on my calendar tomorrow, and add a haircut at 5pm",
      timestamp: Date.now(),
    });
    return conversationId;
  }

  it('escalates the conversation mode without swapping the persona', () => {
    const conversationId = seedChitchatConversation();

    persistConversationModeEscalation({
      conversationId,
      reason: 'side_effect_capability_discovered',
      blockedToolNames: ['calendar_create_event'],
    });

    const conversation = findConversation(conversationId);
    expect(conversation?.mode).toBe('agentic');
    expect(conversation?.personaId).toBe('default');
  });

  it('leaves the transcript untouched — no persona-switch marker for an automatic escalation', () => {
    const conversationId = seedChitchatConversation();

    persistConversationModeEscalation({
      conversationId,
      reason: 'side_effect_capability_discovered',
      blockedToolNames: ['calendar_create_event'],
    });

    const conversation = findConversation(conversationId);
    expect(conversation?.personaEvents ?? []).toHaveLength(0);
  });

  it('is a no-op once the conversation is already agentic', () => {
    const conversationId = seedChitchatConversation();
    useChatStore.getState().updateModeInConversation(conversationId, 'agentic');
    useChatStore
      .getState()
      .updatePersonaInConversation(conversationId, 'super-agent', { recordEvent: false });

    persistConversationModeEscalation({
      conversationId,
      reason: 'side_effect_capability_discovered',
      blockedToolNames: ['calendar_create_event'],
    });

    const conversation = findConversation(conversationId);
    // Unchanged: the persona set before this call (by an explicit user action, in this
    // case) is never touched by escalation either way.
    expect(conversation?.personaId).toBe('super-agent');
    expect(conversation?.personaEvents ?? []).toHaveLength(0);
  });

  it('ignores an empty or unknown conversation id', () => {
    expect(() =>
      persistConversationModeEscalation({
        conversationId: '   ',
        reason: 'side_effect_capability_discovered',
        blockedToolNames: [],
      }),
    ).not.toThrow();

    expect(() =>
      persistConversationModeEscalation({
        conversationId: 'not-a-real-conversation',
        reason: 'side_effect_capability_discovered',
        blockedToolNames: [],
      }),
    ).not.toThrow();
  });
});
