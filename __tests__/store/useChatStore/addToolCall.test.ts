// ---------------------------------------------------------------------------
// Tests - useChatStore: addToolCall
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
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
});
