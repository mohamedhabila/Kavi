// ---------------------------------------------------------------------------
// Tests - useChatStore: recordConversationUsage
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('recordConversationUsage', () => {
    it('should append usage entries and aggregate totals', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().recordConversationUsage(convId, {
        model: 'gpt-5.4',
        providerId: 'openai',
        inputTokens: 120,
        outputTokens: 45,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        timestamp: 1700000000000,
        estimatedCost: 0.0012,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.usage).toEqual(
        expect.objectContaining({
          totalInput: 120,
          totalOutput: 45,
          totalCacheRead: 10,
          totalCacheWrite: 5,
          totalTokens: 165,
          totalCost: 0.0012,
          totalCalls: 1,
          lastModel: 'gpt-5.4',
          lastProviderId: 'openai',
          lastUpdatedAt: 1700000000000,
        }),
      );
      expect(conv.usage?.entries).toHaveLength(1);
      expect(conv.usage?.entries[0]).toEqual(
        expect.objectContaining({
          model: 'gpt-5.4',
          providerId: 'openai',
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
          estimatedCost: 0.0012,
          timestamp: 1700000000000,
        }),
      );
    });

    it('should preserve provider-reported total tokens when greater than input plus output', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().recordConversationUsage(convId, {
        model: 'gemini-2.5-pro',
        providerId: 'gemini',
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 190,
        timestamp: 1700000000001,
        estimatedCost: 0.0013,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.usage).toEqual(
        expect.objectContaining({
          totalInput: 120,
          totalOutput: 45,
          totalTokens: 190,
        }),
      );
      expect(conv.usage?.entries[0]).toEqual(
        expect.objectContaining({
          totalTokens: 190,
        }),
      );
    });

    it('should preserve usage attribution metadata on entries', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().recordConversationUsage(convId, {
        model: 'gpt-5.4',
        providerId: 'openai',
        source: 'pilot',
        sessionId: 'sub-123',
        parentSessionId: 'super-456',
        agentRunId: 'run-789',
        inputTokens: 90,
        outputTokens: 30,
        totalTokens: 120,
        timestamp: 1700000000002,
        estimatedCost: 0.0014,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.usage?.entries[0]).toEqual(
        expect.objectContaining({
          providerId: 'openai',
          source: 'pilot',
          sessionId: 'sub-123',
          parentSessionId: 'super-456',
          agentRunId: 'run-789',
        }),
      );
    });

    it('should dedupe image usage entries by tool call id', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().recordConversationUsage(convId, {
        model: 'gpt-image-2',
        providerId: 'openai',
        modality: 'image',
        toolCallId: 'tool-image-1',
        inputTokens: 320,
        outputTokens: 960,
        totalTokens: 1280,
        estimatedCost: 0.032,
      });

      useChatStore.getState().recordConversationUsage(convId, {
        model: 'gpt-image-2',
        providerId: 'openai',
        modality: 'image',
        toolCallId: 'tool-image-1',
        inputTokens: 320,
        outputTokens: 960,
        totalTokens: 1280,
        estimatedCost: 0.032,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.usage).toEqual(
        expect.objectContaining({
          totalTokens: 1280,
          totalCost: 0.032,
          totalCalls: 1,
        }),
      );
      expect(conv.usage?.entries).toHaveLength(1);
      expect(conv.usage?.entries[0]).toEqual(
        expect.objectContaining({
          modality: 'image',
          toolCallId: 'tool-image-1',
        }),
      );
    });
  });
});
