// ---------------------------------------------------------------------------
// Tests - useChatStore: deleteConversation
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('deleteConversation', () => {
    it('should remove the conversation', () => {
      const id = useChatStore.getState().createConversation('p1', 's');
      expect(useChatStore.getState().conversations).toHaveLength(1);

      useChatStore.getState().deleteConversation(id);
      expect(useChatStore.getState().conversations).toHaveLength(0);
    });

    it('should clear active id if the deleted was active', () => {
      const id = useChatStore.getState().createConversation('p1', 's');
      expect(useChatStore.getState().activeConversationId).toBe(id);

      useChatStore.getState().deleteConversation(id);
      expect(useChatStore.getState().activeConversationId).toBeNull();
    });

    it('should not change active id when deleting a non-active conversation', () => {
      const id1 = useChatStore.getState().createConversation('p1', 's');
      const id2 = useChatStore.getState().createConversation('p2', 's');

      useChatStore.getState().deleteConversation(id1);
      expect(useChatStore.getState().activeConversationId).toBe(id2);
    });
  });
});
