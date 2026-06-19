// ---------------------------------------------------------------------------
// Tests - useChatStore: updateModelInConversation
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('updateModelInConversation', () => {
    it('should update provider and model for conversation', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().updateModelInConversation(convId, 'p2', 'gpt-5-mini');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.providerId).toBe('p2');
      expect(conv.modelOverride).toBe('gpt-5-mini');
    });

    it('should not alter other conversations', () => {
      const id1 = useChatStore.getState().createConversation('p1', 's');
      const id2 = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().updateModelInConversation(id1, 'p2', 'gpt-5-mini');

      const other = useChatStore.getState().conversations.find((c) => c.id === id2)!;
      expect(other.providerId).toBe('p1');
    });
  });
});
