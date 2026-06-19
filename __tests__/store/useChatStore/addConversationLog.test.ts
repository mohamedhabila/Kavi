// ---------------------------------------------------------------------------
// Tests - useChatStore: addConversationLog
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('addConversationLog', () => {
    it('should append a timestamped conversation log entry', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().addConversationLog(convId, {
        title: 'Usage recorded',
        detail: 'gpt-5.4 · in 120 · out 45',
        kind: 'usage',
        level: 'success',
        timestamp: 1700000001234,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.logs).toHaveLength(1);
      expect(conv.logs?.[0]).toEqual(
        expect.objectContaining({
          title: 'Usage recorded',
          detail: 'gpt-5.4 · in 120 · out 45',
          kind: 'usage',
          level: 'success',
          timestamp: 1700000001234,
        }),
      );
      expect(conv.logs?.[0].id).toEqual(expect.any(String));
    });
  });
});
