// ---------------------------------------------------------------------------
// Tests - useChatStore: addMessage
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';
import { addConversation } from '../../helpers/chatConversationFixtures';

describe('useChatStore', () => {
  describe('addMessage', () => {
    it('should add a message to the conversation', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        role: 'user',
        content: 'Hello',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages).toHaveLength(1);
      expect(conv.messages[0].role).toBe('user');
      expect(conv.messages[0].content).toBe('Hello');
      expect(conv.messages[0].id).toBeTruthy();
      expect(conv.messages[0].timestamp).toBeGreaterThan(0);
    });

    it('never makes the first message the title of an endless conversation', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        role: 'user',
        content: 'What is the weather today?',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.title).toBe('');
    });

    it('shows the focus memory names as the title', () => {
      const convId = addConversation('p1', 's');
      const otherId = addConversation('p1', 's', undefined, { activate: false });

      useChatStore.getState().setConversationFocus(convId, 'Weekend in Porto');

      const conversations = useChatStore.getState().conversations;
      expect(conversations.find((c) => c.id === convId)?.title).toBe('Weekend in Porto');
      expect(conversations.find((c) => c.id === otherId)?.title).toBe('');
    });

    it('should use custom id if provided', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'custom-id',
        role: 'user',
        content: 'Test',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].id).toBe('custom-id');
    });

    it('preserves an explicit source timestamp for replay and import', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'historical-message',
        role: 'user',
        content: 'Historical turn',
        timestamp: 123_456,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].timestamp).toBe(123_456);
      expect(conv.updatedAt).toBe(123_456);
    });

    it('should not modify other conversations', () => {
      const convId1 = addConversation('p1', 's');
      const convId2 = addConversation('p2', 's');
      useChatStore.getState().addMessage(convId1, {
        role: 'user',
        content: 'Test',
      });

      const conv2 = useChatStore.getState().conversations.find((c) => c.id === convId2)!;
      expect(conv2.messages).toHaveLength(0);
    });

    it('keeps a long chat of short messages live, however many there are', () => {
      const convId = addConversation('p1', 's');

      // The live history is bounded by tokens, not by a message count.
      for (let i = 0; i < 2_000; i++) {
        useChatStore.getState().addMessage(convId, {
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
        });
      }

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages).toHaveLength(2_000);
      expect(conv.messages[0].id).toBe('msg-0');
      expect(conv.messages[conv.messages.length - 1].id).toBe('msg-1999');
    });

    it('keeps a short conversation as it is', () => {
      const convId = addConversation('p1', 's');

      for (let i = 0; i < 10; i++) {
        useChatStore.getState().addMessage(convId, {
          id: `msg-${i}`,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages).toHaveLength(10);
    });
  });
});
