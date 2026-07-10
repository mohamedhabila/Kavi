import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore updateMessageAssistantMetadata', () => {
  it('preserves code-owned memory attribution across lifecycle metadata updates', () => {
    const conversationId = useChatStore.getState().createConversation('p1', 's');
    useChatStore.getState().addMessage(conversationId, {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Remembered answer',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
      },
    });

    useChatStore.getState().updateMessageAssistantMetadata(conversationId, 'assistant-1', {
      kind: 'final',
      completionStatus: 'incomplete',
      finishReason: 'terminal_review_pending',
    });

    const message = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)?.messages[0];
    expect(message?.assistantMetadata).toEqual({
      kind: 'final',
      completionStatus: 'incomplete',
      finishReason: 'terminal_review_pending',
      memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
    });
  });

  it('replaces attribution only when the next model turn supplies an exact event', () => {
    const conversationId = useChatStore.getState().createConversation('p1', 's');
    useChatStore.getState().addMessage(conversationId, {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Remembered answer',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        memoryRetrievalEventId: 'retrieval_event_m123_1_old',
      },
    });

    useChatStore.getState().updateMessageAssistantMetadata(conversationId, 'assistant-1', {
      kind: 'final',
      completionStatus: 'complete',
      memoryRetrievalEventId: 'retrieval_event_m123_2_new',
    });

    const message = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)?.messages[0];
    expect(message?.assistantMetadata?.memoryRetrievalEventId).toBe('retrieval_event_m123_2_new');
  });
});
