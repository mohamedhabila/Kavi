// ---------------------------------------------------------------------------
// Tests - useChatStore: addMessage
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('addMessage', () => {
    it('should add a message to the conversation', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
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

    it('should auto-title from the first user message', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        role: 'user',
        content: 'What is the weather today?',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.title).toBe('What is the weather today?');
    });

    it('should not re-title after first message', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        role: 'user',
        content: 'First message',
      });
      useChatStore.getState().addMessage(convId, {
        role: 'user',
        content: 'Second message',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.title).toBe('First message');
    });

    it('should use custom id if provided', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'custom-id',
        role: 'user',
        content: 'Test',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].id).toBe('custom-id');
    });

    it('should not modify other conversations', () => {
      const convId1 = useChatStore.getState().createConversation('p1', 's');
      const convId2 = useChatStore.getState().createConversation('p2', 's');
      useChatStore.getState().addMessage(convId1, {
        role: 'user',
        content: 'Test',
      });

      const conv2 = useChatStore.getState().conversations.find((c) => c.id === convId2)!;
      expect(conv2.messages).toHaveLength(0);
    });

    it('should cap messages at 500, preserving the first message', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      // Add first (system/greeting) message
      useChatStore.getState().addMessage(convId, {
        id: 'first-msg',
        role: 'user',
        content: 'Hello, this is the first message',
      });

      // Add 500 more messages to exceed the cap (501 total before cap)
      for (let i = 1; i <= 500; i++) {
        useChatStore.getState().addMessage(convId, {
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'assistant' : 'user',
          content: `Message ${i}`,
        });
      }

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages).toHaveLength(500);
      // First message is always preserved
      expect(conv.messages[0].id).toBe('first-msg');
      expect(conv.messages[0].content).toBe('Hello, this is the first message');
      // The oldest intermediate messages are dropped; last message is the most recent
      expect(conv.messages[conv.messages.length - 1].id).toBe('msg-500');
    });

    it('should not cap when under 500 messages', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

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
