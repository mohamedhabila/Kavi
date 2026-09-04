import { resolveConversationStartsAgentic } from '../../../../src/engine/graph/conversation/resolveConversationRuntimeMode';
import { useChatStore } from '../../../../src/store/useChatStore';

describe('resolveConversationStartsAgentic', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  it('follows the conversation\'s persisted mode for a non-SuperAgent persona in agentic mode', () => {
    const conversationId = useChatStore
      .getState()
      .createConversation('openai', 'system', undefined, {
        personaId: 'default',
        mode: 'agentic',
      });

    // Mode is a conversation property: `default` is not the SuperAgent persona, yet the
    // conversation was explicitly toggled to agentic, and that must win over the persona.
    expect(
      resolveConversationStartsAgentic({ conversationId, personaIsSuperAgent: false }),
    ).toBe(true);
  });

  it('follows the conversation into chitchat even when the persona is SuperAgent', () => {
    const conversationId = useChatStore
      .getState()
      .createConversation('openai', 'system', undefined, {
        personaId: 'super-agent',
        mode: 'chitchat',
      });

    expect(
      resolveConversationStartsAgentic({ conversationId, personaIsSuperAgent: true }),
    ).toBe(false);
  });

  it('falls back to the persona signal for a session with no tracked conversation (a worker run)', () => {
    // A sub-agent worker session runs under its own sessionId, never registered as a
    // UI conversation, so there is nothing in the store to read.
    expect(
      resolveConversationStartsAgentic({
        conversationId: 'worker-session-42',
        personaIsSuperAgent: true,
      }),
    ).toBe(true);
    expect(
      resolveConversationStartsAgentic({
        conversationId: 'worker-session-42',
        personaIsSuperAgent: false,
      }),
    ).toBe(false);
  });

  it('falls back to the persona signal for an empty conversation id', () => {
    expect(
      resolveConversationStartsAgentic({ conversationId: '', personaIsSuperAgent: true }),
    ).toBe(true);
  });
});
