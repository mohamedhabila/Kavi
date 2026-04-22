// ---------------------------------------------------------------------------
// Tests — Chat Store
// ---------------------------------------------------------------------------

import { useChatStore } from '../../src/store/useChatStore';

// Reset store between tests
beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
});

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

  describe('setActiveConversation', () => {
    it('should set the active conversation id', () => {
      const id = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().setActiveConversation(null);
      expect(useChatStore.getState().activeConversationId).toBeNull();

      useChatStore.getState().setActiveConversation(id);
      expect(useChatStore.getState().activeConversationId).toBe(id);
    });
  });

  describe('deleteConversation', () => {
    it('should remove the conversation', () => {
      const id = useChatStore.getState().createConversation('p1', 's');
      expect(useChatStore.getState().conversations).toHaveLength(1);

      useChatStore.getState().deleteConversation(id);
      expect(useChatStore.getState().conversations).toHaveLength(0);
    });

    it('should clear active id if the deleted was active', () => {
      const id = useChatStore.getState().createConversation('p1', 's');
      expect(useChatStore.getState().activeConversationId).toBe(id);

      useChatStore.getState().deleteConversation(id);
      expect(useChatStore.getState().activeConversationId).toBeNull();
    });

    it('should not change active id when deleting a non-active conversation', () => {
      const id1 = useChatStore.getState().createConversation('p1', 's');
      const id2 = useChatStore.getState().createConversation('p2', 's');

      useChatStore.getState().deleteConversation(id1);
      expect(useChatStore.getState().activeConversationId).toBe(id2);
    });
  });

  describe('clearAllConversations', () => {
    it('should remove all conversations and clear active id', () => {
      useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().createConversation('p2', 's');
      expect(useChatStore.getState().conversations).toHaveLength(2);

      useChatStore.getState().clearAllConversations();
      expect(useChatStore.getState().conversations).toEqual([]);
      expect(useChatStore.getState().activeConversationId).toBeNull();
    });
  });

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

  describe('applyConversationCompaction', () => {
    it('should replace the persisted transcript with the compacted message set', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-old-user',
        role: 'user',
        content: 'Original request',
      });
      useChatStore.getState().addMessage(convId, {
        id: 'msg-old-assistant',
        role: 'assistant',
        content: 'Original response',
      });

      useChatStore.getState().applyConversationCompaction(convId, [
        {
          id: 'compact-1',
          role: 'system',
          content: '[Conversation Summary]\n\n## Task Overview\nOriginal request',
          timestamp: Date.now(),
        },
        {
          id: 'msg-tail-user',
          role: 'user',
          content: 'Most recent user turn',
          timestamp: Date.now(),
        },
        {
          id: 'msg-tail-assistant',
          role: 'assistant',
          content: 'Most recent assistant turn',
          timestamp: Date.now(),
        },
      ]);

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages.map((message) => message.id)).toEqual([
        'compact-1',
        'msg-tail-user',
        'msg-tail-assistant',
      ]);
      expect(conv.messages[0].role).toBe('system');
      expect(conv.messages[0].content).toContain('[Conversation Summary]');
    });
  });

  describe('updateMessage', () => {
    it('should update message content', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: 'Initial',
      });

      useChatStore.getState().updateMessage(convId, 'msg1', 'Updated content');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].content).toBe('Updated content');
    });

    it('should avoid rebuilding state when content is unchanged', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: 'Stable content',
      });

      const beforeConversation = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!;
      const beforeMessage = beforeConversation.messages[0];

      useChatStore.getState().updateMessage(convId, 'msg1', 'Stable content');

      const afterConversation = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(afterConversation).toBe(beforeConversation);
      expect(afterConversation.messages[0]).toBe(beforeMessage);
    });
  });

  describe('updateMessageReasoning', () => {
    it('should update message reasoning', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
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

  describe('updateMessageEffect', () => {
    it('should update message effect metadata', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
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

  describe('addToolCall', () => {
    it('should add a tool call to a message', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, { id: 'msg1', role: 'assistant', content: '' });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'tc1',
        name: 'read_file',
        arguments: '{"path":"test.txt"}',
        status: 'pending',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].toolCalls).toHaveLength(1);
      expect(conv.messages[0].toolCalls![0].name).toBe('read_file');
      expect(conv.messages[0].toolCalls![0].startedAt).toEqual(expect.any(Number));
      expect(conv.messages[0].toolCalls![0].updatedAt).toEqual(expect.any(Number));
    });

    it('should upsert an existing tool call instead of appending a duplicate', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, { id: 'msg1', role: 'assistant', content: '' });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'tc1',
        name: 'read_file',
        arguments: '{"path":"test.txt"}',
        status: 'pending',
      });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'tc1',
        name: 'read_file',
        arguments: '{"path":"test.txt"}',
        status: 'running',
        progressText: 'Reading file',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].toolCalls).toHaveLength(1);
      expect(conv.messages[0].toolCalls![0]).toEqual(
        expect.objectContaining({
          id: 'tc1',
          status: 'running',
          progressText: 'Reading file',
        }),
      );
    });

    it('should upsert synthetic placeholder ids within the same assistant message', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, { id: 'msg1', role: 'assistant', content: '' });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'gemini-call-0',
        name: 'image_generate',
        arguments: '{"prompt":"cat"}',
        status: 'pending',
      });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'gemini-call-0',
        name: 'image_generate',
        arguments: '{"prompt":"cat"}',
        status: 'running',
        progressText: 'Generating image',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].toolCalls).toHaveLength(1);
      expect(conv.messages[0].toolCalls![0]).toEqual(
        expect.objectContaining({
          id: 'gemini-call-0',
          name: 'image_generate',
          status: 'running',
          progressText: 'Generating image',
        }),
      );
    });

    it('should upsert a logical tool call when streaming metadata upgrades the id', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, { id: 'msg1', role: 'assistant', content: '' });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'fc_1',
        name: 'read_file',
        arguments: '{"path":"test.txt"}',
        status: 'pending',
        raw: {
          id: 'fc_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"test.txt"}',
          },
          _openai: {
            itemId: 'fc_1',
            outputIndex: 0,
          },
        },
      });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'call_1',
        name: 'read_file',
        arguments: '{"path":"test.txt"}',
        status: 'running',
        progressText: 'Reading file',
        raw: {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"test.txt"}',
          },
          _openai: {
            itemId: 'fc_1',
            callId: 'call_1',
            outputIndex: 0,
          },
        },
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].toolCalls).toHaveLength(1);
      expect(conv.messages[0].toolCalls![0]).toEqual(
        expect.objectContaining({
          id: 'call_1',
          status: 'running',
          progressText: 'Reading file',
        }),
      );
    });

    it('should append distinct tool calls when provider output indexes restart at zero', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, { id: 'msg1', role: 'assistant', content: '' });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'call_1',
        name: 'read_file',
        arguments: '{"path":"test.txt"}',
        status: 'completed',
        raw: {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"test.txt"}',
          },
          _openai: {
            itemId: 'fc_1',
            callId: 'call_1',
            outputIndex: 0,
          },
        },
      });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'call_2',
        name: 'write_file',
        arguments: '{"path":"fix.ts"}',
        status: 'completed',
        raw: {
          id: 'call_2',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: '{"path":"fix.ts"}',
          },
          _openai: {
            itemId: 'fc_2',
            callId: 'call_2',
            outputIndex: 0,
          },
        },
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].toolCalls).toHaveLength(2);
      expect(conv.messages[0].toolCalls!.map((toolCall) => toolCall.id)).toEqual([
        'call_1',
        'call_2',
      ]);
    });

    it('should skip no-op tool call upserts', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, { id: 'msg1', role: 'assistant', content: '' });

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'tc1',
        name: 'read_file',
        arguments: '{"path":"test.txt"}',
        status: 'pending',
      });

      const beforeConversation = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!;
      const beforeMessage = beforeConversation.messages[0];
      const beforeToolCall = beforeMessage.toolCalls![0];

      useChatStore.getState().addToolCall(convId, 'msg1', {
        id: 'tc1',
        name: 'read_file',
        arguments: '{"path":"test.txt"}',
        status: 'pending',
      });

      const afterConversation = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(afterConversation).toBe(beforeConversation);
      expect(afterConversation.messages[0]).toBe(beforeMessage);
      expect(afterConversation.messages[0].toolCalls![0]).toBe(beforeToolCall);
    });
  });

  describe('updateToolCallStatus', () => {
    it('should update tool call status and result', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: '{}', status: 'pending' }],
      });

      useChatStore.getState().updateToolCallStatus(convId, 'msg1', 'tc1', 'completed', {
        result: 'file contents here',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].toolCalls![0].status).toBe('completed');
      expect(conv.messages[0].toolCalls![0].result).toBe('file contents here');
      expect(conv.messages[0].toolCalls![0].completedAt).toEqual(expect.any(Number));
    });

    it('promotes completed image_generate results into assistant attachments', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'image_generate', arguments: '{"prompt":"cat"}', status: 'running' },
        ],
      });

      useChatStore.getState().updateToolCallStatus(convId, 'msg1', 'tc1', 'completed', {
        result: JSON.stringify({
          status: 'generated',
          providerId: 'openai',
          model: 'gpt-image-2',
          mimeType: 'image/png',
          fileUri: 'file:///mock/documents/workspace/conv-1/generated-image-test.png',
          fileName: 'generated-image-test.png',
          size: 4096,
          workspacePath: 'generated-image-test.png',
        }),
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].attachments).toEqual([
        expect.objectContaining({
          id: 'generated-image-tc1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/generated-image-test.png',
          name: 'generated-image-test.png',
          mimeType: 'image/png',
          size: 4096,
          workspacePath: 'generated-image-test.png',
        }),
      ]);
    });

    it('promotes completed image_edit results into assistant attachments', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'image_edit',
            arguments: '{"prompt":"Make it cinematic","imagePath":"source.png"}',
            status: 'running',
          },
        ],
      });

      useChatStore.getState().updateToolCallStatus(convId, 'msg1', 'tc1', 'completed', {
        result: JSON.stringify({
          status: 'edited',
          providerId: 'openai',
          model: 'gpt-image-2',
          mimeType: 'image/png',
          fileUri: 'file:///mock/documents/workspace/conv-1/edited-image-test.png',
          fileName: 'edited-image-test.png',
          size: 2048,
          workspacePath: 'edited-image-test.png',
          sourceCount: 1,
        }),
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].attachments).toEqual([
        expect.objectContaining({
          id: 'generated-image-tc1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/edited-image-test.png',
          name: 'edited-image-test.png',
          mimeType: 'image/png',
          size: 2048,
          workspacePath: 'edited-image-test.png',
        }),
      ]);
    });

    it('should handle failure status with error', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: '{}', status: 'running' }],
      });

      useChatStore.getState().updateToolCallStatus(convId, 'msg1', 'tc1', 'failed', {
        error: 'File not found',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].toolCalls![0].status).toBe('failed');
      expect(conv.messages[0].toolCalls![0].error).toBe('File not found');
    });

    it('should ignore redundant terminal tool status updates', () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000001000);
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: '{}', status: 'running' }],
      });

      useChatStore.getState().updateToolCallStatus(convId, 'msg1', 'tc1', 'completed', {
        result: 'file contents here',
      });

      const beforeConversation = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!;
      const beforeMessage = beforeConversation.messages[0];
      const beforeToolCall = beforeMessage.toolCalls![0];

      nowSpy.mockReturnValue(1700000002000);
      useChatStore.getState().updateToolCallStatus(convId, 'msg1', 'tc1', 'completed', {
        result: 'file contents here',
      });

      const afterConversation = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(afterConversation).toBe(beforeConversation);
      expect(afterConversation.messages[0]).toBe(beforeMessage);
      expect(afterConversation.messages[0].toolCalls![0]).toBe(beforeToolCall);
      expect(afterConversation.messages[0].toolCalls![0].completedAt).toBe(1700000001000);

      nowSpy.mockRestore();
    });
  });

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

  describe('Persist Configuration', () => {
    it('migrates legacy assistant messages to explicit assistant metadata', async () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const migrated = await persistOptions.migrate(
        {
          conversations: [
            {
              id: 'conv-legacy',
              title: 'Legacy Conversation',
              messages: [
                { id: 'user-1', role: 'user', content: 'Audit the repository', timestamp: 1 },
                {
                  id: 'assistant-tool',
                  role: 'assistant',
                  content: 'Inspecting the repository now.',
                  timestamp: 2,
                  toolCalls: [
                    { id: 'tc-1', name: 'read_file', arguments: '{}', status: 'completed' },
                  ],
                },
                {
                  id: 'assistant-final',
                  role: 'assistant',
                  content: 'The audit is complete.',
                  timestamp: 3,
                },
              ],
              createdAt: 1,
              updatedAt: 3,
              providerId: 'p1',
              systemPrompt: 'sys',
            },
          ],
          activeConversationId: 'conv-legacy',
        },
        3,
      );

      expect(migrated.conversations[0].messages[1].assistantMetadata).toEqual(
        expect.objectContaining({
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'legacy_migration',
        }),
      );
      expect(migrated.conversations[0].messages[2].assistantMetadata).toEqual(
        expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'legacy_migration',
        }),
      );
    });

    it('normalizes same-version persisted replay metadata during merge', () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const merged = persistOptions.merge(
        {
          conversations: [
            {
              id: 'conv-merge',
              title: 'Persisted Conversation',
              messages: [
                {
                  id: 'assistant-1',
                  role: 'assistant',
                  content: 'Recovered assistant output',
                  timestamp: 3,
                  providerReplay: {
                    openaiResponseId: '  resp_merge  ',
                    openaiResponseOutput: [{ id: 'item_1', type: 'reasoning' }, 'bad-item'],
                    geminiParts: [{ text: 'part-1' }, 42],
                    unexpected: 'drop-me',
                  },
                },
              ],
              createdAt: 1,
              updatedAt: 3,
              providerId: 'p1',
              systemPrompt: 'sys',
            },
          ],
          activeConversationId: 'conv-merge',
        },
        useChatStore.getState(),
      );

      expect(merged.conversations[0].messages[0].providerReplay).toEqual({
        openaiResponseId: 'resp_merge',
        openaiResponseOutput: [{ id: 'item_1', type: 'reasoning' }],
        geminiParts: [{ text: 'part-1' }],
      });
      expect(merged.activeConversationId).toBe('conv-merge');
    });
  });

  describe('agent run tracking', () => {
    it('should start a structured agent run with initial phases and checkpoint', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-1',
        goal: 'Audit the repository and apply the fix.',
        timestamp: 1700000002000,
        summary: { assistantTurns: 1 },
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.activeAgentRunId).toBe(runId);
      expect(conv.agentRuns).toHaveLength(1);
      expect(conv.agentRuns?.[0]).toEqual(
        expect.objectContaining({
          id: runId,
          userMessageId: 'msg-user-1',
          goal: 'Audit the repository and apply the fix.',
          status: 'running',
          currentPhase: 'assess',
          plan: expect.objectContaining({
            objective: 'Audit the repository and apply the fix.',
            successCriteria: expect.arrayContaining(['Produce the requested deliverable.']),
            stopConditions: expect.arrayContaining([
              'Stop when the deliverable is complete and the success criteria are satisfied.',
            ]),
          }),
          summary: expect.objectContaining({
            assistantTurns: 1,
            startedTools: 0,
            completedTools: 0,
          }),
        }),
      );
      expect(conv.agentRuns?.[0].phases).toEqual([
        expect.objectContaining({ key: 'assess', status: 'active' }),
        expect.objectContaining({ key: 'plan', status: 'pending' }),
        expect.objectContaining({ key: 'work', status: 'pending' }),
        expect.objectContaining({ key: 'review', status: 'pending' }),
        expect.objectContaining({ key: 'pilot', status: 'pending' }),
        expect.objectContaining({ key: 'deliver', status: 'pending' }),
      ]);
      expect(conv.agentRuns?.[0].checkpoints[0]).toEqual(
        expect.objectContaining({
          title: 'Turn started',
          detail: 'Audit the repository and apply the fix.',
          kind: 'run',
          timestamp: 1700000002000,
        }),
      );
    });

    it('should update the active run phase, summary, and checkpoints', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-2',
        goal: 'Ship the patch.',
      });

      useChatStore.getState().setAgentRunPhase(convId, 'plan', {
        status: 'completed',
        detail: 'Inspect, patch, and verify.',
        checkpointTitle: 'Plan captured',
      });
      useChatStore.getState().updateAgentRunPlan(convId, {
        objective: 'Ship the patch with verified workflow state.',
        successCriteria: ['Persist the plan', 'Render the timeline'],
        stopConditions: ['Stop when verified'],
        workstreams: [
          {
            id: 'ws-1',
            title: 'Store model',
            goal: 'Persist semantic planning data',
          },
        ],
        rawPlan: 'Objective: Ship the patch with verified workflow state.',
      });
      useChatStore.getState().updateAgentRunSummary(convId, {
        assistantTurns: 2,
        startedTools: 1,
        completedTools: 1,
        latestSummary: 'Completed read_file',
      });
      useChatStore.getState().appendAgentRunCheckpoint(convId, {
        kind: 'tool',
        title: 'Tool completed: read_file',
        detail: 'Inspected the target file.',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.[0]!;

      expect(run.currentPhase).toBe('plan');
      expect(run.phases.find((phase) => phase.key === 'assess')).toEqual(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(run.phases.find((phase) => phase.key === 'plan')).toEqual(
        expect.objectContaining({
          status: 'completed',
          detail: 'Inspect, patch, and verify.',
        }),
      );
      expect(run.plan).toEqual(
        expect.objectContaining({
          objective: 'Ship the patch with verified workflow state.',
          successCriteria: ['Persist the plan', 'Render the timeline'],
          stopConditions: ['Stop when verified'],
          workstreams: [
            expect.objectContaining({
              id: 'ws-1',
              title: 'Store model',
              goal: 'Persist semantic planning data',
            }),
          ],
          rawPlan: 'Objective: Ship the patch with verified workflow state.',
        }),
      );
      expect(run.summary).toEqual(
        expect.objectContaining({
          assistantTurns: 2,
          startedTools: 1,
          completedTools: 1,
        }),
      );
      expect(run.latestSummary).toBe('Completed read_file');
      expect(run.checkpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Plan captured' }),
          expect.objectContaining({ title: 'Tool completed: read_file', kind: 'tool' }),
        ]),
      );
    });

    it('preserves the current phase by default when late worker updates target an earlier phase', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-phase-regression',
        goal: 'Keep later workflow phases stable.',
        timestamp: 1700000002100,
      });

      useChatStore.getState().setAgentRunPhase(
        convId,
        'review',
        {
          status: 'active',
          detail: 'Verifying the worker output.',
          checkpointTitle: 'Review started',
          checkpointDetail: 'Verifying the worker output.',
          timestamp: 1700000002200,
        },
        runId,
      );

      useChatStore.getState().setAgentRunPhase(
        convId,
        'work',
        {
          status: 'active',
          detail: 'Worker progress update arrived late.',
          checkpointTitle: 'Worker completed: Final verifier',
          checkpointDetail: 'Worker progress update arrived late.',
          timestamp: 1700000002300,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.currentPhase).toBe('review');
      expect(run.phases.find((phase) => phase.key === 'review')).toEqual(
        expect.objectContaining({
          status: 'active',
          detail: 'Verifying the worker output.',
        }),
      );
      expect(run.phases.find((phase) => phase.key === 'work')).toEqual(
        expect.objectContaining({
          status: 'completed',
        }),
      );
      expect(run.checkpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Review started' }),
          expect.objectContaining({ title: 'Worker completed: Final verifier' }),
        ]),
      );
    });

    it('allows work to reclaim the current phase when regression is explicitly permitted', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-phase-regression-allowed',
        goal: 'Let resumed execution move back into work.',
        timestamp: 1700000002400,
      });

      useChatStore.getState().setAgentRunPhase(
        convId,
        'review',
        {
          status: 'active',
          detail: 'Review is inspecting the current output.',
          checkpointTitle: 'Review started',
          checkpointDetail: 'Review is inspecting the current output.',
          timestamp: 1700000002500,
        },
        runId,
      );

      useChatStore.getState().setAgentRunPhase(
        convId,
        'work',
        {
          status: 'active',
          detail: 'Execution resumed after pilot requested another work step.',
          checkpointTitle: 'Work resumed',
          checkpointDetail: 'Execution resumed after pilot requested another work step.',
          timestamp: 1700000002600,
          allowRegression: true,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.currentPhase).toBe('work');
      expect(run.phases.find((phase) => phase.key === 'work')).toEqual(
        expect.objectContaining({
          status: 'active',
          detail: 'Execution resumed after pilot requested another work step.',
        }),
      );
      expect(run.phases.find((phase) => phase.key === 'review')).toEqual(
        expect.objectContaining({
          status: 'completed',
        }),
      );
      expect(run.checkpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Review started' }),
          expect.objectContaining({ title: 'Work resumed' }),
        ]),
      );
    });

    it('records and upserts structured workflow evidence on a specific run', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-evidence',
        goal: 'Capture structured workflow evidence.',
        timestamp: 1700000002050,
      });

      const firstEntries = useChatStore.getState().recordAgentRunEvidence(
        convId,
        {
          kind: 'fact',
          status: 'candidate',
          title: 'Repository scan',
          content: 'glob_search found 12 files relevant to the fix.',
          dedupeKey: 'repo-scan',
          sourceName: 'glob_search',
          toolName: 'glob_search',
        },
        {
          timestamp: 1700000002060,
        },
        runId,
      );

      const secondEntries = useChatStore.getState().recordAgentRunEvidence(
        convId,
        {
          kind: 'fact',
          status: 'verified',
          content: 'glob_search confirmed 12 files relevant to the fix.',
          dedupeKey: 'repo-scan',
          sourceName: 'glob_search',
          toolName: 'glob_search',
        },
        {
          timestamp: 1700000002070,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(firstEntries).toHaveLength(1);
      expect(secondEntries).toHaveLength(1);
      expect(run.evidence).toEqual([
        expect.objectContaining({
          kind: 'fact',
          status: 'verified',
          title: 'Repository scan',
          content: 'glob_search confirmed 12 files relevant to the fix.',
          dedupeKey: 'repo-scan',
          sourceName: 'glob_search',
          toolName: 'glob_search',
          createdAt: 1700000002060,
          updatedAt: 1700000002070,
        }),
      ]);
    });

    it('skips redundant progress-only phase and summary updates', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-progress',
        goal: 'Track worker progress efficiently.',
        timestamp: 1700000003000,
      });

      useChatStore.getState().setAgentRunPhase(
        convId,
        'work',
        {
          status: 'active',
          detail: 'Scanning repository files',
          timestamp: 1700000003100,
        },
        runId,
      );
      useChatStore.getState().updateAgentRunSummary(
        convId,
        {
          latestSummary: 'Scanning repository files',
          timestamp: 1700000003100,
        },
        runId,
      );

      const conversationBefore = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!;
      const runBefore = conversationBefore.agentRuns?.find((run) => run.id === runId)!;

      useChatStore.getState().setAgentRunPhase(
        convId,
        'work',
        {
          status: 'active',
          detail: 'Scanning repository files',
          timestamp: 1700000003200,
        },
        runId,
      );
      useChatStore.getState().updateAgentRunSummary(
        convId,
        {
          latestSummary: 'Scanning repository files',
          timestamp: 1700000003200,
        },
        runId,
      );

      const conversationAfter = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const runAfter = conversationAfter.agentRuns?.find((run) => run.id === runId)!;

      expect(conversationAfter).toBe(conversationBefore);
      expect(runAfter).toBe(runBefore);
      expect(runAfter.updatedAt).toBe(1700000003100);
      expect(runAfter.latestSummary).toBe('Scanning repository files');
    });

    it('should retain the initial checkpoint anchor for long-running sessions while trimming the oldest middle entries', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-long',
        goal: 'Keep a durable execution timeline.',
        timestamp: 1700000002500,
      });

      for (let index = 0; index < 80; index += 1) {
        useChatStore.getState().appendAgentRunCheckpoint(convId, {
          kind: 'tool',
          title: `Tool completed: checkpoint-${index}`,
          detail: `Checkpoint ${index}`,
          timestamp: 1700000002600 + index,
        });
      }

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.[0]!;

      expect(run.checkpoints).toHaveLength(64);
      expect(run.checkpoints[0]).toEqual(
        expect.objectContaining({
          title: 'Turn started',
          detail: 'Keep a durable execution timeline.',
        }),
      );
      expect(run.checkpoints[1]).toEqual(
        expect.objectContaining({
          title: 'Tool completed: checkpoint-17',
        }),
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Tool completed: checkpoint-79',
        }),
      );
    });

    it('should complete the active run and clear the active run id', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-3',
        goal: 'Finish the work.',
      });

      useChatStore.getState().completeAgentRun(convId, {
        status: 'completed',
        latestSummary: 'duration 12s · assistant turns 2 · tools 1/1',
        checkpointTitle: 'Turn completed',
        summary: {
          assistantTurns: 2,
          startedTools: 1,
          completedTools: 1,
          durationMs: 12000,
        },
        timestamp: 1700000003000,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.[0]!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('completed');
      expect(run.currentPhase).toBe('deliver');
      expect(run.completedAt).toBe(1700000003000);
      expect(run.phases.find((phase) => phase.key === 'deliver')).toEqual(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(run.summary).toEqual(
        expect.objectContaining({
          assistantTurns: 2,
          startedTools: 1,
          completedTools: 1,
          durationMs: 12000,
        }),
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Turn completed',
          timestamp: 1700000003000,
        }),
      );
    });

    it('should keep a run active while waiting for background workers', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-4',
        goal: 'Wait for the delegated workers.',
        timestamp: 1700000003500,
      });

      useChatStore.getState().setAgentRunAwaitingBackgroundWorkers(
        convId,
        true,
        {
          latestSummary: 'Waiting for 2 background workers to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 2 background workers to finish.',
          timestamp: 1700000003600,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.[0]!;

      expect(conv.activeAgentRunId).toBe(runId);
      expect(run.awaitingBackgroundWorkers).toBe(true);
      expect(run.latestSummary).toBe('Waiting for 2 background workers to finish.');
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Waiting for background workers',
          detail: 'Waiting for 2 background workers to finish.',
        }),
      );
    });

    it('should persist pending async operations on a running run', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-async',
        goal: 'Monitor the workflow.',
        timestamp: 1700000003650,
      });

      useChatStore.getState().updateAgentRunPendingAsyncOperations(
        convId,
        [
          {
            key: 'expo-workflow:123',
            kind: 'expo-workflow',
            resourceId: '123',
            displayName: 'Expo workflow 123',
            status: 'running',
            lastUpdatedByTool: 'expo_eas_workflow_status',
            updatedAt: 1700000003700,
            monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
            statusArgs: {
              projectId: 'proj-1',
              workflowRunId: '123',
            },
            waitToolName: 'expo_eas_workflow_wait',
            waitArgs: {
              projectId: 'proj-1',
              workflowRunId: '123',
            },
          },
        ],
        {
          latestSummary: 'Waiting for Expo workflow 123 to finish.',
          timestamp: 1700000003700,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.pendingAsyncOperations).toEqual([
        expect.objectContaining({
          key: 'expo-workflow:123',
          kind: 'expo-workflow',
          resourceId: '123',
          status: 'running',
        }),
      ]);
      expect(run.latestSummary).toBe('Waiting for Expo workflow 123 to finish.');
    });

    it('should update a specific historical run without mutating the active run', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const oldRunId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-5',
        goal: 'First workflow.',
        timestamp: 1700000004000,
      });

      const activeRunId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-6',
        goal: 'Second workflow.',
        timestamp: 1700000005000,
      });

      useChatStore.getState().appendAgentRunCheckpoint(
        convId,
        {
          kind: 'sub-agent',
          title: 'Worker completed: Old worker',
          detail: 'The original worker finished after the next user turn started.',
          timestamp: 1700000005100,
        },
        oldRunId,
      );
      useChatStore.getState().updateAgentRunSummary(
        convId,
        {
          latestSummary: 'Late worker completion recorded on the superseded run.',
          timestamp: 1700000005100,
        },
        oldRunId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const oldRun = conv.agentRuns?.find((run) => run.id === oldRunId)!;
      const activeRun = conv.agentRuns?.find((run) => run.id === activeRunId)!;

      expect(conv.activeAgentRunId).toBe(activeRunId);
      expect(oldRun.status).toBe('cancelled');
      expect(oldRun.latestSummary).toBe('Late worker completion recorded on the superseded run.');
      expect(oldRun.checkpoints[oldRun.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Worker completed: Old worker',
        }),
      );
      expect(activeRun.latestSummary).toBeUndefined();
      expect(activeRun.checkpoints[activeRun.checkpoints.length - 1]).not.toEqual(
        expect.objectContaining({
          title: 'Worker completed: Old worker',
        }),
      );
    });

    it('should recover interrupted foreground runs on app restart', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-7',
        role: 'user',
        content: 'Keep working on the patch.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-7',
        goal: 'Finish the patch.',
        timestamp: 1700000006000,
      });

      useChatStore.getState().recoverInterruptedAgentRuns([], {
        timestamp: 1700000007000,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('failed');
      expect(run.latestSummary).toBe(
        'The run was interrupted because the app restarted before completion.',
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Run interrupted on app restart',
          detail: 'The run was interrupted because the app restarted before completion.',
        }),
      );
    });

    it('should recover pending async-operation runs on app restart', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-async-restart',
        role: 'user',
        content: 'Keep monitoring the deployment.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-async-restart',
        goal: 'Monitor the deployment until it completes.',
        timestamp: 1700000007050,
      });

      useChatStore.getState().updateAgentRunPendingAsyncOperations(
        convId,
        [
          {
            key: 'ssh-background-job:bg-1',
            kind: 'ssh-background-job',
            resourceId: 'bg-1',
            displayName: 'SSH background job bg-1',
            status: 'running',
            lastUpdatedByTool: 'ssh_background_job_status',
            updatedAt: 1700000007100,
            monitorToolNames: ['ssh_background_job_status', 'ssh_background_job_wait'],
            statusArgs: { jobId: 'bg-1' },
            waitToolName: 'ssh_background_job_wait',
            waitArgs: { jobId: 'bg-1' },
          },
        ],
        {
          latestSummary: 'Waiting for SSH background job bg-1 to finish.',
          timestamp: 1700000007100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns([], {
        timestamp: 1700000007200,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBe(runId);
      expect(run.status).toBe('running');
      expect(run.latestSummary).toBe(
        'Recovered 1 pending asynchronous operation after app restart. Resuming monitoring.',
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Recovered async workflow monitoring',
          detail:
            'Recovered 1 pending asynchronous operation after app restart. Resuming monitoring.',
        }),
      );
    });

    it('should recover background-worker runs from terminal worker state on app restart', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-8',
        role: 'user',
        content: 'Wait for the worker results.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-8',
        goal: 'Coordinate the delegated workers.',
        timestamp: 1700000008000,
      });

      useChatStore.getState().setAgentRunAwaitingBackgroundWorkers(
        convId,
        true,
        {
          latestSummary: 'Waiting for 1 background worker to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 1 background worker to finish.',
          timestamp: 1700000008100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns(
        [
          {
            sessionId: 'sub-1',
            parentConversationId: convId,
            depth: 0,
            startedAt: 1700000008200,
            updatedAt: 1700000009000,
            status: 'completed',
            sandboxPolicy: 'inherit',
            output: 'Worker completed the delegated task.',
          },
        ],
        {
          timestamp: 1700000009100,
        },
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('completed');
      expect(run.latestSummary).toBe(
        'Background workers finished before the app restarted. Recovering the final response from verified results.',
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Recovered background completion',
        }),
      );
    });

    it('should clear stale pending async operations when recovery terminalizes a run', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-8b',
        role: 'user',
        content: 'Wait for the worker results.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-8b',
        goal: 'Coordinate the delegated workers.',
        timestamp: 1700000008050,
      });

      useChatStore.getState().updateAgentRunPendingAsyncOperations(
        convId,
        [
          {
            key: 'ssh-background-job:bg-stale',
            kind: 'ssh-background-job',
            resourceId: 'bg-stale',
            displayName: 'SSH background job bg-stale',
            status: 'running',
            lastUpdatedByTool: 'ssh_background_job_status',
            updatedAt: 1700000008075,
            monitorToolNames: ['ssh_background_job_status', 'ssh_background_job_wait'],
            statusArgs: { jobId: 'bg-stale' },
            waitToolName: 'ssh_background_job_wait',
            waitArgs: { jobId: 'bg-stale' },
          },
        ],
        {
          latestSummary: 'Waiting for SSH background job bg-stale to finish.',
          timestamp: 1700000008075,
        },
        runId,
      );

      useChatStore.getState().setAgentRunAwaitingBackgroundWorkers(
        convId,
        true,
        {
          latestSummary: 'Waiting for 1 background worker to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 1 background worker to finish.',
          timestamp: 1700000008100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns(
        [
          {
            sessionId: 'sub-1b',
            parentConversationId: convId,
            depth: 0,
            startedAt: 1700000008200,
            updatedAt: 1700000009000,
            status: 'completed',
            sandboxPolicy: 'inherit',
            output: 'Worker completed the delegated task.',
          },
        ],
        {
          timestamp: 1700000009100,
        },
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.status).toBe('completed');
      expect(run.pendingAsyncOperations).toBeUndefined();
    });

    it('should keep failed background-worker runs active for pilot review on app restart', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-9',
        role: 'user',
        content: 'Recover the failed worker workflow.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-9',
        goal: 'Recover the failed worker workflow.',
        timestamp: 1700000010000,
      });

      useChatStore.getState().setAgentRunAwaitingBackgroundWorkers(
        convId,
        true,
        {
          latestSummary: 'Waiting for 1 background worker to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 1 background worker to finish.',
          timestamp: 1700000010100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns(
        [
          {
            sessionId: 'sub-err-1',
            parentConversationId: convId,
            agentRunId: runId,
            depth: 0,
            startedAt: 1700000010200,
            updatedAt: 1700000010900,
            status: 'error',
            sandboxPolicy: 'inherit',
            output: 'Worker failed while running the verification command.',
          },
        ],
        {
          timestamp: 1700000011000,
        },
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBe(runId);
      expect(run.status).toBe('running');
      expect(run.awaitingBackgroundWorkers).toBe(true);
      expect(run.currentPhase).toBe('pilot');
      expect(run.latestSummary).toContain('pilot review');
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Recovered background failure for pilot review',
        }),
      );
    });

    it('should fail app-restart-interrupted background-worker runs instead of reopening them for pilot review', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-10',
        role: 'user',
        content: 'Recover the interrupted worker workflow.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-10',
        goal: 'Recover the interrupted worker workflow.',
        timestamp: 1700000012000,
      });

      useChatStore.getState().setAgentRunAwaitingBackgroundWorkers(
        convId,
        true,
        {
          latestSummary: 'Waiting for 1 background worker to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 1 background worker to finish.',
          timestamp: 1700000012100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns(
        [
          {
            sessionId: 'sub-interrupted-1',
            parentConversationId: convId,
            agentRunId: runId,
            depth: 0,
            startedAt: 1700000012200,
            updatedAt: 1700000012900,
            status: 'error',
            sandboxPolicy: 'inherit',
            output: 'Worker was interrupted because the app restarted before completion.',
            currentActivity: 'Worker was interrupted because the app restarted before completion.',
          },
        ],
        {
          timestamp: 1700000013000,
        },
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('failed');
      expect(run.awaitingBackgroundWorkers).toBe(false);
      expect(run.latestSummary).toBe(
        'Background workers were interrupted because the app restarted before completion.',
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Background workers interrupted on app restart',
        }),
      );
    });

    it('should mark in-flight tool calls as failed when a foreground run is interrupted on app restart', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-11',
        role: 'user',
        content: 'Keep fetching sources.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-11',
        goal: 'Keep fetching sources.',
        timestamp: 1700000014000,
      });

      useChatStore.getState().addMessage(convId, {
        id: 'assistant-tools-1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'tc-fetch-1',
            name: 'web_fetch',
            arguments: '{}',
            status: 'running',
            startedAt: 1700000014100,
            updatedAt: 1700000014100,
          },
        ],
      });

      useChatStore.getState().recoverInterruptedAgentRuns([], {
        timestamp: 1700000015000,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const assistantMessage = conv.messages.find((message) => message.id === 'assistant-tools-1')!;
      const toolCall = assistantMessage.toolCalls?.[0];
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.status).toBe('failed');
      expect(toolCall).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Tool call was interrupted because the app restarted before completion.',
        }),
      );
    });
  });

  describe('updateModelInConversation', () => {
    it('should update provider and model for conversation', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().updateModelInConversation(convId, 'p2', 'gpt-5-mini');

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.providerId).toBe('p2');
      expect(conv.modelOverride).toBe('gpt-5-mini');
    });

    it('should not alter other conversations', () => {
      const id1 = useChatStore.getState().createConversation('p1', 's');
      const id2 = useChatStore.getState().createConversation('p1', 's');

      useChatStore.getState().updateModelInConversation(id1, 'p2', 'gpt-5-mini');

      const other = useChatStore.getState().conversations.find((c) => c.id === id2)!;
      expect(other.providerId).toBe('p1');
    });
  });
});
