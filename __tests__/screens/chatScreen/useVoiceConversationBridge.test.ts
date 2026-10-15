import { act, renderHook } from '@testing-library/react-native';
import { useVoiceConversationBridge } from '../../../src/screens/chatScreen/useVoiceConversationBridge';
import {
  resetVoiceConversationBridgeForTests,
  sendVoiceConversationTurn,
} from '../../../src/services/voice/voiceConversationBridge';
import { useChatStore } from '../../../src/store/useChatStore';
import { addConversation } from '../../helpers/chatConversationFixtures';
import type { StreamingDraftListener } from '../../../src/screens/useStreamingDrafts';

function streamingDrafts() {
  const listeners = new Set<StreamingDraftListener>();
  return {
    subscribe: jest.fn((listener: StreamingDraftListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    publish: (messageId: string, content: string | undefined) => {
      for (const listener of listeners) {
        listener(messageId, content === undefined ? undefined : { content });
      }
    },
    listenerCount: () => listeners.size,
  };
}

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
    const conversationId = addConversation('openrouter', 'system prompt');
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
    renderHook(() => useVoiceConversationBridge(handleSend, streamingDrafts().subscribe));

    let response: unknown;
    await act(async () => {
      response = await sendVoiceConversationTurn('spoken request', {
        additionalSystemPrompt: 'Be concise.',
      });
    });

    expect(response).toEqual({
      response: 'Persisted canonical reply',
      spokenText: 'Persisted canonical reply',
    });
    expect(handleSend).toHaveBeenCalledWith('spoken request', {
      additionalSystemPrompt: 'Be concise.',
    });
  });

  it('does not replay an old assistant response when the new run produces none', async () => {
    const conversationId = addConversation('openrouter', 'system prompt');
    useChatStore.getState().addMessage(conversationId, {
      id: 'old-assistant',
      role: 'assistant',
      content: 'Old response',
    });
    const handleSend = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useVoiceConversationBridge(handleSend, streamingDrafts().subscribe));

    await expect(sendVoiceConversationTurn('new request')).rejects.toMatchObject({
      kind: 'no_response',
    });
  });

  it('ignores intermediate drafts and returns the final response', async () => {
    const conversationId = addConversation('openrouter', 'system prompt');
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
    renderHook(() => useVoiceConversationBridge(handleSend, streamingDrafts().subscribe));

    await expect(sendVoiceConversationTurn('hello')).resolves.toEqual({
      response: 'Finished reply',
      spokenText: 'Working draft\n\nFinished reply',
    });
  });

  it('reports what the turn says as it streams, every assistant message in order', async () => {
    const conversationId = addConversation('openrouter', 'system prompt');
    useChatStore.getState().addMessage(conversationId, {
      id: 'earlier',
      role: 'assistant',
      content: 'An earlier answer',
    });
    const drafts = streamingDrafts();
    const handleSend = jest.fn(async () => {
      drafts.publish('earlier', 'An earlier answer, edited');
      drafts.publish('step', 'Let me check');
      drafts.publish('step', 'Let me check your calendar.');
      drafts.publish('answer', 'You are free');
      drafts.publish('answer', undefined);
      const store = useChatStore.getState();
      store.addMessage(conversationId, {
        id: 'step',
        role: 'assistant',
        content: 'Let me check your calendar.',
        assistantMetadata: { kind: 'intermediate', completionStatus: 'incomplete' },
      });
      store.addMessage(conversationId, {
        id: 'answer',
        role: 'assistant',
        content: 'You are free at three.',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      });
    });
    renderHook(() => useVoiceConversationBridge(handleSend, drafts.subscribe));
    const onReplyText = jest.fn();

    let reply: unknown;
    await act(async () => {
      reply = await sendVoiceConversationTurn('Am I free this afternoon?', { onReplyText });
    });

    expect(onReplyText.mock.calls).toEqual([
      ['Let me check'],
      ['Let me check your calendar.'],
      ['Let me check your calendar.\n\nYou are free'],
    ]);
    expect(reply).toEqual({
      response: 'You are free at three.',
      spokenText: 'Let me check your calendar.\n\nYou are free at three.',
    });
    expect(handleSend).toHaveBeenCalledWith('Am I free this afternoon?', undefined);
    expect(drafts.listenerCount()).toBe(0);
  });
});
