// ---------------------------------------------------------------------------
// Tests - useChatStore: updateMessageReasoning
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';
import { addConversation } from '../../helpers/chatConversationFixtures';

describe('useChatStore', () => {
  describe('updateMessageReasoning', () => {
    it('should update message reasoning', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: 'Answer',
      });

      useChatStore.getState().updateMessageReasoning(convId, 'msg1', 'I thought about this...');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].reasoning).toBe('I thought about this...');
    });
  });
});
