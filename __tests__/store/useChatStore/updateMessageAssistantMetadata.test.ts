import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore updateMessageAssistantMetadata', () => {
  it.each([
    ['terminal_review_pending', 'incomplete'],
    ['response_failed', 'incomplete'],
    ['graph_finalized', 'complete'],
    ['synthesized_from_evidence', 'complete'],
    ['graph_expected_output', 'complete'],
    ['fallback_from_evidence', 'complete'],
  ] as const)(
    'preserves code-owned memory attribution for the %s lifecycle rewrite',
    (finishReason, completionStatus) => {
    const conversationId = useChatStore.getState().createConversation('p1', 's');
    useChatStore.getState().addMessage(conversationId, {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Remembered answer',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
      },
    });

    useChatStore.getState().updateMessageAssistantMetadata(conversationId, 'assistant-1', {
      kind: 'final',
      completionStatus,
      finishReason,
    });

    const message = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)?.messages[0];
    expect(message?.assistantMetadata).toEqual({
      kind: 'final',
      completionStatus,
      finishReason,
      memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
    });
    },
  );

  it('replaces attribution only when the next model turn supplies an exact event', () => {
    const conversationId = useChatStore.getState().createConversation('p1', 's');
    useChatStore.getState().addMessage(conversationId, {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Remembered answer',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        memoryRetrievalEventId: 'retrieval_event_m123_1_old',
      },
    });

    useChatStore.getState().updateMessageAssistantMetadata(conversationId, 'assistant-1', {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
      memoryRetrievalEventId: 'retrieval_event_m123_2_new',
    });

    const message = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)?.messages[0];
    expect(message?.assistantMetadata?.memoryRetrievalEventId).toBe('retrieval_event_m123_2_new');
  });

  it('clears stale attribution when a new model final used no selected memory', () => {
    const conversationId = useChatStore.getState().createConversation('p1', 's');
    useChatStore.getState().addMessage(conversationId, {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Remembered answer',
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        memoryRetrievalEventId: 'retrieval_event_m123_1_old',
      },
    });

    useChatStore.getState().updateMessageAssistantMetadata(conversationId, 'assistant-1', {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    });

    const message = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)?.messages[0];
    expect(message?.assistantMetadata?.memoryRetrievalEventId).toBeUndefined();
  });
});
