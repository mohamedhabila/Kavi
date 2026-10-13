// ---------------------------------------------------------------------------
// Tests - useChatStore: setActiveConversation
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';
import { addConversation } from '../../helpers/chatConversationFixtures';

describe('useChatStore', () => {
  describe('setActiveConversation', () => {
    it('should set the active conversation id', () => {
      const id = addConversation('p1', 's');
      useChatStore.getState().setActiveConversation(null);
      expect(useChatStore.getState().activeConversationId).toBeNull();

      useChatStore.getState().setActiveConversation(id);
      expect(useChatStore.getState().activeConversationId).toBe(id);
    });
  });
});
