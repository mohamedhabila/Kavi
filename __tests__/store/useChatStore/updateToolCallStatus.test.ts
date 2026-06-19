// ---------------------------------------------------------------------------
// Tests - useChatStore: updateToolCallStatus
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
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
});
