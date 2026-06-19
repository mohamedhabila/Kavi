// ---------------------------------------------------------------------------
// Tests - Orchestrator: Reasoning tokens
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Reasoning tokens', () => {
    it('should pass through reasoning tokens', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'reasoning', content: 'Let me think...' },
          { type: 'token', content: 'Answer' },
          { type: 'done', content: 'Answer' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Think', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onReasoning).toHaveBeenCalledWith('Let me think...');
    });
  });
});
