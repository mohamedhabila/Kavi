import { act, renderHook } from '@testing-library/react-native';
import { useVoiceConversationBridge } from '../../../src/screens/chatScreen/useVoiceConversationBridge';
import {
  resetVoiceConversationBridgeForTests,
  sendVoiceConversationTurn,
} from '../../../src/services/voice/voiceConversationBridge';
import { useChatStore } from '../../../src/store/useChatStore';

describe('useVoiceConversationBridge', () => {
  beforeEach(() => {
    resetVoiceConversationBridgeForTests();
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  afterEach(() => {
    resetVoiceConversationBridgeForTests();
  });

  it('returns the newly persisted final assistant message from the active conversation', async () => {
    const conversationId = useChatStore
      .getState()
      .createConversation('openrouter', 'system prompt');
    const handleSend = jest.fn(async (input: string) => {
      const store = useChatStore.getState();
      store.addMessage(conversationId, {
        id: 'voice-user',
        role: 'user',
        content: input,
      });
      store.addMessage(conversationId, {
        id: 'voice-assistant',
        role: 'assistant',
        content: 'Persisted canonical reply',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      });
    });
    renderHook(() => useVoiceConversationBridge(handleSend));

    let response = '';
    await act(async () => {
      response = await sendVoiceConversationTurn('spoken request', {
        additionalSystemPrompt: 'Be concise.',
      });
    });

    expect(response).toBe('Persisted canonical reply');
    expect(handleSend).toHaveBeenCalledWith('spoken request', undefined, {
      additionalSystemPrompt: 'Be concise.',
    });
  });

  it('does not replay an old assistant response when the new run produces none', async () => {
    const conversationId = useChatStore
      .getState()
      .createConversation('openrouter', 'system prompt');
    useChatStore.getState().addMessage(conversationId, {
      id: 'old-assistant',
      role: 'assistant',
      content: 'Old response',
    });
    const handleSend = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useVoiceConversationBridge(handleSend));

    await expect(sendVoiceConversationTurn('new request')).rejects.toMatchObject({
      kind: 'no_response',
    });
  });

  it('ignores intermediate drafts and returns the final response', async () => {
    const conversationId = useChatStore
      .getState()
      .createConversation('openrouter', 'system prompt');
    const handleSend = jest.fn(async () => {
      const store = useChatStore.getState();
      store.addMessage(conversationId, {
        id: 'intermediate',
        role: 'assistant',
        content: 'Working draft',
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'incomplete',
          finishReason: 'tool_calls',
        },
      });
      store.addMessage(conversationId, {
        id: 'final',
        role: 'assistant',
        content: 'Finished reply',
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      });
    });
    renderHook(() => useVoiceConversationBridge(handleSend));

    await expect(sendVoiceConversationTurn('hello')).resolves.toBe('Finished reply');
  });
});
