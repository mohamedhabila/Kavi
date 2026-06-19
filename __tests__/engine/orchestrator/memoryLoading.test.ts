// ---------------------------------------------------------------------------
// Tests - Orchestrator: Memory loading
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  getConversationMemoryForSystemPrompt,
  buildLivingMemorySections,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Memory loading', () => {
    it('does not inject legacy file memory and delegates to the canonical memory bridge', async () => {
      (getConversationMemoryForSystemPrompt as jest.Mock).mockResolvedValueOnce(
        'User is named John',
      );

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

      expect(getConversationMemoryForSystemPrompt).not.toHaveBeenCalled();
      expect(buildLivingMemorySections).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv1',
          messages: expect.any(Array),
        }),
      );
      const apiMessages = mockStreamMessage.mock.calls[0]?.[0] as Array<{
        role: string;
        content: string;
      }>;
      expect(apiMessages[0]?.content).not.toContain('Conversation memory:');
      expect(apiMessages[0]?.content).not.toContain('User is named John');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('uses the shared workspace conversation id for canonical memory recall', async () => {
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
        workspaceConversationId: 'parent-conv-7',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(getConversationMemoryForSystemPrompt).not.toHaveBeenCalled();
      expect(buildLivingMemorySections).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'parent-conv-7',
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
