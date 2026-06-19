// ---------------------------------------------------------------------------
// Tests - Orchestrator: Cancellation
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  expectTerminalGraphBeforeSequenceEntry,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Cancellation', () => {
    it('should handle abort signal', async () => {
      const abortController = new AbortController();

      mockStreamMessage.mockImplementationOnce(async function* () {
        yield { type: 'token', content: 'Start' };
        abortController.abort();
        yield { type: 'token', content: ' end' };
        yield { type: 'done', content: 'Start end' };
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
        signal: abortController,
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
      expect(callbacks.onDone).toHaveBeenCalled();
      expect(callbacks.calls.onAgentControlGraphStateChange.at(-1)).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          terminalReason: 'cancelled',
        }),
      );
      expectTerminalGraphBeforeSequenceEntry(callbacks, 'cancelled', 'state');
    });
  });
});
