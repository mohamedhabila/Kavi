// ---------------------------------------------------------------------------
// Tests - useChatStore: setActiveConversation
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('setActiveConversation', () => {
    it('should set the active conversation id', () => {
      const id = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().setActiveConversation(null);
      expect(useChatStore.getState().activeConversationId).toBeNull();

      useChatStore.getState().setActiveConversation(id);
      expect(useChatStore.getState().activeConversationId).toBe(id);
    });
  });
});
