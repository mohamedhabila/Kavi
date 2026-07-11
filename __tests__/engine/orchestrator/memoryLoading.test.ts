// ---------------------------------------------------------------------------
// Tests - Orchestrator: Memory loading
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  buildLivingMemorySections,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Memory loading', () => {
    it('delegates memory retrieval to the canonical memory bridge', async () => {
      mockStreamMessage.mockImplementationOnce(() => {
        return createStreamGenerator([
          { type: 'token', content: 'Hi John!' },
          { type: 'done', content: 'Hi John!' },
        ]);
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(buildLivingMemorySections).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv1',
          messages: expect.any(Array),
          retrievalLlm: expect.objectContaining({
            model: 'gpt-5.4',
            provider: expect.objectContaining({
              id: options.provider.id,
            }),
          }),
        }),
      );
      const apiMessages = mockStreamMessage.mock.calls[0]?.[0] as Array<{
        role: string;
        content: string;
      }>; 
      expect(apiMessages[0]?.content).not.toContain('Conversation memory:');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('uses the explicit memory boundary independently from the file workspace', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Shared memory works' },
          { type: 'done', content: 'Shared memory works' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'worker-session-1',
        memoryConversationId: 'parent-memory-7',
        workspaceConversationId: 'parent-files-7',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(buildLivingMemorySections).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'parent-memory-7',
        }),
      );
    });

    it('keeps the primary model on tool-follow-up iterations', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Finished' },
          { type: 'done', content: 'Finished' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({ availableModels: ['gpt-5.4', 'gpt-5.4-mini'] }),
        model: 'gpt-5.4',
        conversationId: 'conv-economy',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage.mock.calls[1][1].model).toBe('gpt-5.4');
      expect(mockStreamMessage.mock.calls[1][1].maxTokens).toBe(32000);
    });
  });
});
