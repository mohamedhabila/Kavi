// ---------------------------------------------------------------------------
// Tests - useChatStore: clearAllConversations
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('clearAllConversations', () => {
    it('should remove all conversations and clear active id', () => {
      useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().createConversation('p2', 's');
      expect(useChatStore.getState().conversations).toHaveLength(2);

      useChatStore.getState().clearAllConversations();
      expect(useChatStore.getState().conversations).toEqual([]);
      expect(useChatStore.getState().activeConversationId).toBeNull();
    });
  });
});
