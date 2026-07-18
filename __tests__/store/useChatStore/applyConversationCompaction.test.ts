// ---------------------------------------------------------------------------
// Tests - useChatStore: applyConversationCompaction
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('applyConversationCompaction', () => {
    it('should replace the persisted transcript with the compacted message set', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-old-user',
        role: 'user',
        content: 'Original request',
      });
      useChatStore.getState().addMessage(convId, {
        id: 'msg-old-assistant',
        role: 'assistant',
        content: 'Original response',
      });
      useChatStore.getState().addMessage(convId, {
        id: 'msg-tail-user',
        role: 'user',
        content: 'Most recent user turn',
      });
      useChatStore.getState().addMessage(convId, {
        id: 'msg-tail-assistant',
        role: 'assistant',
        content: 'Most recent assistant turn',
      });

      useChatStore.getState().applyConversationCompaction(convId, [
        {
          id: 'compact-1',
          role: 'system',
          content: '[Conversation Summary]\n\n## Task Overview\nOriginal request',
          timestamp: Date.now(),
          compactionProvenance: { version: 1, dependency: 'transcript_only' },
        },
        {
          id: 'msg-tail-user',
          role: 'user',
          content: 'Most recent user turn',
          timestamp: Date.now(),
        },
        {
          id: 'msg-tail-assistant',
          role: 'assistant',
          content: 'Most recent assistant turn',
          timestamp: Date.now(),
        },
      ]);

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages.map((message) => message.id)).toEqual([
        'compact-1',
        'msg-tail-user',
        'msg-tail-assistant',
      ]);
      expect(conv.messages[0].role).toBe('system');
      expect(conv.messages[0].content).toContain('[Conversation Summary]');
    });

    it('preserves the exact source request while its agent run is active', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const sourceRequest = {
        id: 'msg-active-request',
        role: 'user' as const,
        content: 'Complete this long-running mobile task.',
        timestamp: 1,
      };
      useChatStore.getState().addMessage(convId, sourceRequest);
      useChatStore.getState().startAgentRun(convId, {
        userMessageId: sourceRequest.id,
        goal: sourceRequest.content,
        workflowTaskAnchor: {
          sourceMessageId: sourceRequest.id,
          content: sourceRequest.content,
          attachments: [],
        },
        timestamp: 2,
      });
      useChatStore.getState().addMessage(convId, {
        id: 'assistant-active-tail',
        role: 'assistant',
        content: '',
        timestamp: 4,
      });

      useChatStore.getState().applyConversationCompaction(convId, [
        {
          id: 'compact-active-run',
          role: 'system',
          content: '[Conversation Summary]\n\nThe task is still in progress.',
          timestamp: 3,
          compactionProvenance: { version: 1, dependency: 'transcript_only' },
        },
        {
          id: 'assistant-active-tail',
          role: 'assistant',
          content: '',
          timestamp: 4,
        },
      ]);

      const messages = useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === convId)!.messages;
      expect(messages.map((message) => message.id)).toEqual([
        'compact-active-run',
        sourceRequest.id,
        'assistant-active-tail',
      ]);
      expect(messages[1]).toEqual(sourceRequest);
    });

    it('does not promote model-only tool transcript repairs into durable chat', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'durable-user',
        role: 'user',
        content: 'Continue the task.',
        timestamp: 1,
      });
      useChatStore.getState().addMessage(convId, {
        id: 'durable-assistant',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'durable-call',
            name: 'mobile_ui_action',
            arguments: '{}',
            status: 'completed',
            result: 'done',
          },
        ],
      });

      useChatStore.getState().applyConversationCompaction(convId, [
        {
          id: 'compact-tool-repair',
          role: 'system',
          content: '[Conversation Summary]\n\nThe tool call completed.',
          timestamp: 3,
          compactionProvenance: { version: 1, dependency: 'transcript_only' },
        },
        {
          id: 'durable-assistant',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'durable-call',
              name: 'mobile_ui_action',
              arguments: '{}',
              status: 'completed',
              result: 'done',
            },
          ],
        },
        {
          id: 'model-only-synthetic-result',
          role: 'tool',
          content: 'done',
          toolCallId: 'durable-call',
          timestamp: 4,
        },
      ]);

      const messages = useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === convId)!.messages;
      expect(messages.map((message) => message.id)).toEqual([
        'compact-tool-repair',
        'durable-assistant',
      ]);
    });
  });
});
