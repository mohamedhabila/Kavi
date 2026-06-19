// ---------------------------------------------------------------------------
// Tests - useChatStore: setLoading
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('setLoading', () => {
    it('should update isLoading', () => {
      useChatStore.getState().setLoading(true);
      expect(useChatStore.getState().isLoading).toBe(true);

      useChatStore.getState().setLoading(false);
      expect(useChatStore.getState().isLoading).toBe(false);
    });

    it('forces on-device usage entries to remain zero-cost', () => {
      const convId = useChatStore.getState().createConversation('gemma-local', 'system');

      useChatStore.getState().recordConversationUsage(convId, {
        model: 'gemma-4-E2B-it',
        providerId: 'gemma-local',
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
        estimatedCost: 0.55,
        timestamp: 1700000001300,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.usage).toEqual(
        expect.objectContaining({
          totalCost: 0,
        }),
      );
      expect(conv.usage?.entries[0]).toEqual(
        expect.objectContaining({
          estimatedCost: 0,
        }),
      );
    });
  });
});
