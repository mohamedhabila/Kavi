// ---------------------------------------------------------------------------
// Tests - Orchestrator: external workflow guidance
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
  describe('external workflow guidance', () => {
    it('does not inject provider-specific workflow guidance for broad relevant categories', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-expo',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Deploy this Expo app from the GitHub repo and monitor the EAS workflow',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).not.toContain('default to repository-driven EAS Workflows');
      expect(apiMessages[0].content).not.toContain('## Expo / EAS');
      expect(apiMessages[0].content).not.toContain('## Capability Discovery');
    });
  });
});
