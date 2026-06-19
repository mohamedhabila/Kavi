import {
  applyForegroundEditedResend,
  applyForegroundRetryResend,
  FOREGROUND_EDIT_RESEND_REWIND_REASON,
  FOREGROUND_RETRY_REWIND_REASON,
} from '../../src/engine/graph/foregroundConversationReplay';
import type { Conversation } from '../../src/types/conversation';

function createConversation(messages: Conversation['messages']): Conversation {
  return {
    id: 'conv-1',
    title: 'Conversation',
    messages,
    createdAt: 1,
    updatedAt: 1,
    providerId: 'openai',
    model: 'gpt-test',
    systemPrompt: '',
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      totalCalls: 0,
    },
    logs: [],
    agentRuns: [],
  };
}

describe('foreground conversation replay', () => {
  it('rewinds and reapplies edited resend through graph-owned actions', () => {
    const cancelConversationRunForRewind = jest.fn();
    const editMessage = jest.fn();

    const applied = applyForegroundEditedResend({
      actions: {
        cancelConversationRunForRewind,
        editMessage,
      },
      conversationId: 'conv-1',
      editingMessageId: 'user-1',
      text: 'Edited hello',
    });

    expect(applied).toBe(true);
    expect(cancelConversationRunForRewind).toHaveBeenCalledWith(
      'conv-1',
      FOREGROUND_EDIT_RESEND_REWIND_REASON,
    );
    expect(editMessage).toHaveBeenCalledWith('conv-1', 'user-1', 'Edited hello');
  });

  it('rewinds to the preceding user turn when retrying an assistant response', () => {
    const cancelConversationRunForRewind = jest.fn();
    const editMessage = jest.fn();
    const conversation = createConversation([
      { id: 'user-1', role: 'user', content: 'First request', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'First reply', timestamp: 2 },
      { id: 'user-2', role: 'user', content: 'Second request', timestamp: 3 },
      { id: 'assistant-2', role: 'assistant', content: 'Second reply', timestamp: 4 },
    ]);

    const applied = applyForegroundRetryResend({
      actions: {
        cancelConversationRunForRewind,
        editMessage,
      },
      assistantMessageId: 'assistant-2',
      conversation,
      conversationId: 'conv-1',
    });

    expect(applied).toBe(true);
    expect(cancelConversationRunForRewind).toHaveBeenCalledWith(
      'conv-1',
      FOREGROUND_RETRY_REWIND_REASON,
    );
    expect(editMessage).toHaveBeenCalledWith('conv-1', 'user-2', 'Second request');
  });

  it('returns false when a retry target cannot be resolved', () => {
    const cancelConversationRunForRewind = jest.fn();
    const editMessage = jest.fn();
    const conversation = createConversation([
      { id: 'assistant-1', role: 'assistant', content: 'Reply only', timestamp: 1 },
    ]);

    const applied = applyForegroundRetryResend({
      actions: {
        cancelConversationRunForRewind,
        editMessage,
      },
      assistantMessageId: 'assistant-1',
      conversation,
      conversationId: 'conv-1',
    });

    expect(applied).toBe(false);
    expect(cancelConversationRunForRewind).not.toHaveBeenCalled();
    expect(editMessage).not.toHaveBeenCalled();
  });
});
