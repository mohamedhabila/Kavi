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

      useChatStore.getState().applyConversationCompaction(convId, [
        {
          id: 'compact-1',
          role: 'system',
          content: '[Conversation Summary]\n\n## Task Overview\nOriginal request',
          timestamp: Date.now(),
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
  });
});
