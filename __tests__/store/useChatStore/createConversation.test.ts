// ---------------------------------------------------------------------------
// Tests - useChatStore: createConversation
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';
import { normalizePersistedChatState } from '../../../src/store/chatStoreNormalization';

describe('useChatStore', () => {
  describe('createConversation', () => {
    it('should create a new conversation and set it active', () => {
      const id = useChatStore.getState().createConversation('provider1', 'System prompt');
      const state = useChatStore.getState();

      expect(state.conversations).toHaveLength(1);
      expect(state.activeConversationId).toBe(id);
      expect(state.conversations[0].title).toBe('New Conversation');
      expect(state.conversations[0].providerId).toBe('provider1');
      expect(state.conversations[0].systemPrompt).toBe('System prompt');
      expect(state.conversations[0].messages).toEqual([]);
      expect(state.conversations[0].usage).toEqual({
        entries: [],
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheWrite: 0,
        totalTokens: 0,
        totalCost: 0,
        totalCalls: 0,
      });
      expect(state.conversations[0].logs).toEqual([]);
    });

    it('should atomically replace the persona canonical for a durable new chat', () => {
      const oldId = useChatStore
        .getState()
        .getOrCreateCanonicalThread('p1', 'old system', undefined, { personaId: 'researcher' });
      const newId = useChatStore.getState().createConversation('p1', 'new system', undefined, {
        personaId: 'researcher',
        replaceCanonical: true,
      });
      const state = useChatStore.getState();
      const oldConversation = state.conversations.find((conversation) => conversation.id === oldId);
      const newConversation = state.conversations.find((conversation) => conversation.id === newId);

      expect(newConversation).toEqual(
        expect.objectContaining({
          isCanonical: true,
        }),
      );
      expect(newConversation?.archivedFromMigration).toBeUndefined();
      expect(oldConversation).toEqual(
        expect.objectContaining({
          isCanonical: false,
          archivedFromMigration: true,
        }),
      );
      expect(state.activeConversationId).toBe(newId);

      const restarted = normalizePersistedChatState(state);
      expect(restarted.activeConversationId).toBe(newId);
      expect(
        restarted.conversations.find((conversation) => conversation.id === newId)?.isCanonical,
      ).toBe(true);
    });

    it('should support model override', () => {
      const id = useChatStore.getState().createConversation('p1', 'sys', 'gpt-5.4');
      const conv = useChatStore.getState().conversations.find((c) => c.id === id);
      expect(conv!.modelOverride).toBe('gpt-5.4');
    });

    it('should prepend new conversations to the list', () => {
      useChatStore.getState().createConversation('p1', 'sys');
      useChatStore.getState().createConversation('p2', 'sys2');
      const state = useChatStore.getState();

      expect(state.conversations).toHaveLength(2);
      expect(state.conversations[0].providerId).toBe('p2'); // Most recent first
    });

    it('should support creating a conversation without activating it', () => {
      const activeId = useChatStore.getState().createConversation('p1', 'sys');
      const backgroundId = useChatStore.getState().createConversation('p2', 'sys2', undefined, {
        activate: false,
      });
      const state = useChatStore.getState();

      expect(state.activeConversationId).toBe(activeId);
      expect(state.conversations[0].id).toBe(backgroundId);
    });

    it('should support seeding a persona when creating a conversation', () => {
      const id = useChatStore.getState().createConversation('p1', 'sys', undefined, {
        personaId: 'coder',
      });

      const conv = useChatStore.getState().conversations.find((item) => item.id === id);
      expect(conv?.personaId).toBe('coder');
    });
  });
});
