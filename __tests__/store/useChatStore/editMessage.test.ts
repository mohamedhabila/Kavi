// ---------------------------------------------------------------------------
// Tests - useChatStore: rewindUserMessageForResend
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';
import { sanitizeConversationForPersistence } from '../../../src/store/chatPersistence';
import {
  decodeIngestionSourceSnapshot,
  encodeIngestionSourceSnapshot,
} from '../../../src/services/memory/ingestionSourceSnapshot';
import { resolveClosedTurnEndingAt } from '../../../src/services/memory/closedTurn';

describe('useChatStore', () => {
  describe('rewindUserMessageForResend', () => {
    it('replaces the user provenance identity while retaining its position and truncating the tail', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, { id: 'msg1', role: 'user', content: 'First' });
      useChatStore
        .getState()
        .addMessage(convId, { id: 'msg2', role: 'assistant', content: 'Reply' });
      useChatStore.getState().addMessage(convId, { id: 'msg3', role: 'user', content: 'Second' });

      const result = useChatStore
        .getState()
        .rewindUserMessageForResend(convId, 'msg1', 'Edited first');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(result).toEqual({
        status: 'applied',
        replacedMessageId: 'msg1',
        replacementMessageId: conv.messages[0]?.id,
      });
      expect(conv.messages).toHaveLength(1);
      expect(conv.messages[0]?.id).not.toBe('msg1');
      expect(conv.messages[0]?.role).toBe('user');
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

      const result = useChatStore
        .getState()
        .rewindUserMessageForResend(convId, 'msg3', 'Edited second');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;

      expect(result.status).toBe('applied');
      expect(conv.messages.slice(0, 2).map((message) => message.id)).toEqual(['msg1', 'msg2']);
      expect(conv.messages[2]?.id).not.toBe('msg3');
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

    it('allocates a distinct code-owned identity for every repeated edit without mutating prior messages', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'prior-user',
        role: 'user',
        content: 'Prior request',
        timestamp: 1,
      });
      useChatStore.getState().addMessage(convId, {
        id: 'prior-assistant',
        role: 'assistant',
        content: 'Prior response',
        timestamp: 2,
      });
      useChatStore.getState().addMessage(convId, {
        id: 'original-user',
        role: 'user',
        content: 'Original request',
        timestamp: 3,
        attachments: [
          {
            id: 'attachment-1',
            type: 'file',
            uri: 'file:///request.txt',
            name: 'request.txt',
            mimeType: 'text/plain',
            size: 24,
          },
        ],
      });
      useChatStore.getState().addMessage(convId, {
        id: 'discarded-assistant',
        role: 'assistant',
        content: 'Discarded response',
        timestamp: 4,
      });
      const before = useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === convId)!;
      const priorMessages = before.messages.slice(0, 2);

      const first = useChatStore
        .getState()
        .rewindUserMessageForResend(convId, 'original-user', 'First revision');
      expect(first.status).toBe('applied');
      if (first.status !== 'applied') throw new Error('expected first replacement');
      const second = useChatStore
        .getState()
        .rewindUserMessageForResend(convId, first.replacementMessageId, 'Second revision');
      expect(second.status).toBe('applied');
      if (second.status !== 'applied') throw new Error('expected second replacement');

      const after = useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === convId)!;
      expect(
        new Set(['original-user', first.replacementMessageId, second.replacementMessageId]).size,
      ).toBe(3);
      expect(after.messages.slice(0, 2)).toEqual(priorMessages);
      expect(after.messages[0]).toBe(priorMessages[0]);
      expect(after.messages[1]).toBe(priorMessages[1]);
      expect(after.messages[2]).toEqual(
        expect.objectContaining({
          id: second.replacementMessageId,
          role: 'user',
          content: 'Second revision',
          attachments: [
            {
              id: 'attachment-1',
              type: 'file',
              uri: 'file:///request.txt',
              name: 'request.txt',
              mimeType: 'text/plain',
              size: 24,
            },
          ],
        }),
      );
      expect(after.messages.some((message) => message.id === 'discarded-assistant')).toBe(false);
    });

    it('binds the replacement turn publication and ingestion snapshot to only the fresh user identity', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const store = useChatStore.getState();
      store.addMessage(convId, {
        id: 'published-source-start',
        role: 'user',
        content: 'Original request',
        timestamp: 1,
      });
      store.addMessage(convId, {
        id: 'published-source-end',
        role: 'assistant',
        content: 'Original response',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      });
      expect(
        store.transitionMessageMemoryPublication(convId, 'published-source-end', null).status,
      ).toBe('applied');
      expect(
        store.transitionMessageMemoryPublication(convId, 'published-source-end', 'enqueued').status,
      ).toBe('applied');
      expect(
        store.transitionMessageMemoryPublication(convId, 'published-source-end', 'withdrawn')
          .status,
      ).toBe('applied');

      const replacement = store.rewindUserMessageForResend(
        convId,
        'published-source-start',
        'Replacement request',
      );
      expect(replacement.status).toBe('applied');
      if (replacement.status !== 'applied') throw new Error('expected replacement');
      store.addMessage(convId, {
        id: 'replacement-source-end',
        role: 'assistant',
        content: 'Replacement response',
        timestamp: 4,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      });
      expect(
        store.transitionMessageMemoryPublication(convId, 'replacement-source-end', null),
      ).toEqual(
        expect.objectContaining({
          status: 'applied',
          publication: { version: 1, disposition: null },
        }),
      );

      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === convId)!;
      expect(resolveClosedTurnEndingAt(conversation.messages, 'replacement-source-end')).toEqual(
        expect.objectContaining({
          status: 'resolved',
          sourceStartMessageId: replacement.replacementMessageId,
          sourceEndMessageId: 'replacement-source-end',
        }),
      );
      expect(() =>
        encodeIngestionSourceSnapshot({
          messages: conversation.messages,
          sourceStartMessageId: 'published-source-start',
          sourceEndMessageId: 'replacement-source-end',
          priorUserMessageId: null,
        }),
      ).toThrow('memory_ingestion_source_snapshot_source_start_unavailable');

      const snapshot = decodeIngestionSourceSnapshot(
        encodeIngestionSourceSnapshot({
          messages: conversation.messages,
          sourceStartMessageId: replacement.replacementMessageId,
          sourceEndMessageId: 'replacement-source-end',
          priorUserMessageId: null,
        }),
      );
      expect(snapshot.sourceStartMessageId).toBe(replacement.replacementMessageId);
      expect(snapshot.turnMessages.map((message) => message.id)).toEqual([
        replacement.replacementMessageId,
        'replacement-source-end',
      ]);
      expect(JSON.stringify(snapshot)).not.toContain('published-source-start');
    });

    it('persists and reloads only the replacement identity and rejects non-user targets', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const store = useChatStore.getState();
      store.addMessage(convId, { id: 'user-old', role: 'user', content: 'Original', timestamp: 1 });
      store.addMessage(convId, {
        id: 'assistant-old',
        role: 'assistant',
        content: 'Reply',
        timestamp: 2,
      });

      const beforeRejectedMutation = JSON.stringify(
        useChatStore.getState().conversations.find((candidate) => candidate.id === convId),
      );
      expect(store.rewindUserMessageForResend(convId, 'assistant-old', 'Invalid')).toEqual({
        status: 'rejected',
        reason: 'message_ineligible',
      });
      expect(
        JSON.stringify(
          useChatStore.getState().conversations.find((candidate) => candidate.id === convId),
        ),
      ).toBe(beforeRejectedMutation);

      const replacement = store.rewindUserMessageForResend(convId, 'user-old', 'Replacement');
      expect(replacement.status).toBe('applied');
      if (replacement.status !== 'applied') throw new Error('expected replacement');
      const persisted = sanitizeConversationForPersistence(
        useChatStore.getState().conversations.find((candidate) => candidate.id === convId)!,
      );
      const reloaded = JSON.parse(JSON.stringify(persisted)) as typeof persisted;

      expect(reloaded.messages).toEqual([
        expect.objectContaining({
          id: replacement.replacementMessageId,
          role: 'user',
          content: 'Replacement',
        }),
      ]);
      expect(reloaded.messages.some((message) => message.id === 'user-old')).toBe(false);
      expect(reloaded.messages[0]?.memoryPublication).toBeUndefined();
    });
  });
});
