// ---------------------------------------------------------------------------
// Tests - Orchestrator: Usage tracking
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
  describe('Usage tracking', () => {
    it('should report token usage', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Response' },
          { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } },
          { type: 'done', content: 'Response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50,
          model: 'gpt-5.4',
        }),
      );
    });

    it('should synthesize usage when the provider omits usage metadata', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Fallback response' },
          { type: 'done', content: 'Fallback response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [
          { id: 'msg1', role: 'user', content: 'estimate this turn', timestamp: Date.now() },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onUsage).toHaveBeenCalledTimes(1);
      expect(callbacks.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5.4',
        }),
      );

      const [usage] = callbacks.calls.onUsage;
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
    });

    it('should collapse multiple usage snapshots into one final report', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'usage', usage: { inputTokens: 100, outputTokens: 0 } },
          { type: 'token', content: 'Response' },
          { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } },
          { type: 'done', content: 'Response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onUsage).toHaveBeenCalledTimes(1);
      expect(callbacks.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50,
          model: 'gpt-5.4',
        }),
      );
    });

    it('should preserve cached Gemini input usage across cumulative snapshots', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'usage', usage: { inputTokens: 180, outputTokens: 0, cacheReadTokens: 90 } },
          { type: 'token', content: 'Response' },
          {
            type: 'usage',
            usage: { inputTokens: 180, outputTokens: 36, cacheReadTokens: 120, totalTokens: 216 },
          },
          { type: 'done', content: 'Response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gemini-2.5-pro',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onUsage).toHaveBeenCalledTimes(1);
      expect(callbacks.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 180,
          outputTokens: 36,
          cacheReadTokens: 120,
          totalTokens: 216,
          model: 'gemini-2.5-pro',
        }),
      );
    });
  });
});
