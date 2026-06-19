// ---------------------------------------------------------------------------
// Tests - useChatStore: editMessage
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('editMessage', () => {
    it('should update content and truncate subsequent messages', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, { id: 'msg1', role: 'user', content: 'First' });
      useChatStore
        .getState()
        .addMessage(convId, { id: 'msg2', role: 'assistant', content: 'Reply' });
      useChatStore.getState().addMessage(convId, { id: 'msg3', role: 'user', content: 'Second' });

      useChatStore.getState().editMessage(convId, 'msg1', 'Edited first');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages).toHaveLength(1);
      expect(conv.messages[0].content).toBe('Edited first');
    });

    it('should rewind workflow and logs but preserve billed usage after truncation', () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000003000);
      const convId = useChatStore.getState().createConversation('p1', 's');

      useChatStore.setState((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id !== convId
            ? conversation
            : {
                ...conversation,
                messages: [
                  { id: 'msg1', role: 'user', content: 'First', timestamp: 1700000001000 },
                  { id: 'msg2', role: 'assistant', content: 'Reply', timestamp: 1700000001100 },
                  { id: 'msg3', role: 'user', content: 'Second', timestamp: 1700000002000 },
                  {
                    id: 'msg4',
                    role: 'assistant',
                    content: 'Second reply',
                    timestamp: 1700000002100,
                  },
                ],
                updatedAt: 1700000002100,
              },
        ),
      }));

      const firstRunId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg1',
        goal: 'Handle the first request.',
        timestamp: 1700000001200,
      });
      useChatStore.getState().completeAgentRun(
        convId,
        {
          status: 'completed',
          latestSummary: 'First turn completed.',
          timestamp: 1700000001300,
        },
        firstRunId,
      );
      useChatStore.getState().addConversationLog(convId, {
        title: 'First turn log',
        detail: 'Kept after rewind.',
        timestamp: 1700000001250,
      });
      useChatStore.getState().recordConversationUsage(convId, {
        model: 'gpt-5.4',
        providerId: 'p1',
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        estimatedCost: 0.02,
        timestamp: 1700000001260,
      });

      useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg3',
        goal: 'Handle the second request.',
        timestamp: 1700000002200,
      });
      useChatStore.getState().addConversationLog(convId, {
        title: 'Second turn log',
        detail: 'Should be removed by rewind.',
        timestamp: 1700000002250,
      });
      useChatStore.getState().recordConversationUsage(convId, {
        model: 'gpt-5.4',
        providerId: 'p1',
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        estimatedCost: 0.04,
        timestamp: 1700000002260,
      });

      useChatStore.getState().editMessage(convId, 'msg3', 'Edited second');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;

      expect(conv.messages.map((message) => message.id)).toEqual(['msg1', 'msg2', 'msg3']);
      expect(conv.messages[2].content).toBe('Edited second');
      expect(conv.logs?.map((entry) => entry.title)).toEqual(['First turn log']);
      expect(conv.agentRuns?.map((run) => run.userMessageId)).toEqual(['msg1']);
      expect(conv.activeAgentRunId).toBeUndefined();
      expect(conv.usage).toEqual(
        expect.objectContaining({
          totalInput: 22,
          totalOutput: 12,
          totalTokens: 34,
          totalCost: 0.06,
          totalCalls: 2,
        }),
      );
      expect(conv.usage?.entries).toHaveLength(2);

      nowSpy.mockRestore();
    });
  });
});
