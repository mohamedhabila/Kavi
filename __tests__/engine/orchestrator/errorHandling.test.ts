// ---------------------------------------------------------------------------
// Tests - Orchestrator: Error handling
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  executeTool,
  mockStreamMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  expectTerminalGraphBeforeSequenceEntry,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Error handling', () => {
    it('should handle stream errors', async () => {
      mockStreamMessage.mockImplementationOnce(async function* () {
        throw new Error('API rate limited');
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
      expect(callbacks.onError).toHaveBeenCalled();
      expect(callbacks.calls.onError[0].message).toBe('API rate limited');
      expect(callbacks.calls.onAgentControlGraphStateChange.at(-1)).toEqual(
        expect.objectContaining({
          status: 'failed',
          terminalReason: 'API rate limited',
        }),
      );
      expectTerminalGraphBeforeSequenceEntry(callbacks, 'failed', 'error');
    });

    it('does not fail over on authentication errors', async () => {
      mockStreamMessage.mockImplementationOnce(async function* () {
        throw new Error('LLM API error 401: Unauthorized');
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
        allProviders: [makeProvider(), makeProvider({ id: 'backup', apiKey: '' })],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'LLM API error 401: Unauthorized' }),
      );
    });

    it('handles non-Error thrown values (string) in stream', async () => {
      mockStreamMessage.mockImplementationOnce(async function* () {
        throw 'raw string failure';
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
      expect(callbacks.onError).toHaveBeenCalled();
      // onError receives an Error object wrapping the string
      expect(callbacks.calls.onError[0]).toBeInstanceOf(Error);
      expect(callbacks.calls.onError[0].message).toBe('raw string failure');
    });

    it('handles non-Error thrown values (number) in stream', async () => {
      mockStreamMessage.mockImplementationOnce(async function* () {
        throw 42;
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
      expect(callbacks.onError).toHaveBeenCalled();
      expect(callbacks.calls.onError[0]).toBeInstanceOf(Error);
      expect(callbacks.calls.onError[0].message).toBe('42');
    });

    it('handles non-Error thrown values in tool execution', async () => {
      (executeTool as jest.Mock).mockRejectedValueOnce('tool string error');

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"missing.txt"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Recovered' },
          { type: 'done', content: 'Recovered' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Read', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      const completedCall = callbacks.calls.onToolCallComplete[0];
      expect(completedCall.status).toBe('failed');
      expect(completedCall.error).toBe('tool string error');
      expect(callbacks.onDone).toHaveBeenCalled();
    });
  });
});
