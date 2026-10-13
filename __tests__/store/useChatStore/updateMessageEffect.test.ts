// ---------------------------------------------------------------------------
// Tests - useChatStore: updateMessageEffect
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';
import { addConversation } from '../../helpers/chatConversationFixtures';

describe('useChatStore', () => {
  describe('updateMessageEffect', () => {
    it('should update message effect metadata', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: 'Answer',
      });

      useChatStore.getState().updateMessageEffect(convId, 'msg1', 'spotlight');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].effectId).toBe('spotlight');
    });
  });
});
