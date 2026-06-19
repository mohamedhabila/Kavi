// ---------------------------------------------------------------------------
// Tests - useChatStore: updateMessage
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('updateMessage', () => {
    it('should update message content', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: 'Initial',
      });

      useChatStore.getState().updateMessage(convId, 'msg1', 'Updated content');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].content).toBe('Updated content');
    });

    it('should avoid rebuilding state when content is unchanged', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: 'Stable content',
      });

      const beforeConversation = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!;
      const beforeMessage = beforeConversation.messages[0];

      useChatStore.getState().updateMessage(convId, 'msg1', 'Stable content');

      const afterConversation = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(afterConversation).toBe(beforeConversation);
      expect(afterConversation.messages[0]).toBe(beforeMessage);
    });
  });
});
