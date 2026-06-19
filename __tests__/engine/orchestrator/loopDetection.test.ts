// ---------------------------------------------------------------------------
// Tests - Orchestrator: Loop detection
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  executeTool,
  mockStreamMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Loop detection', () => {
    it('hard-stops on critical repeated identical tool calls', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        toolCall: { id: 'tc', name: 'read_file', arguments: '{"path":"same.txt"}' },
      };

      for (let i = 0; i < 20; i++) {
        mockStreamMessage.mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: '' },
            toolCallEvent,
            { type: 'done', content: '' },
          ]),
        );
      }

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Test', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onDone).toHaveBeenCalled();
      expect(callbacks.calls.onToolCallStart.length).toBe(6);
      expect(
        callbacks.calls.onAgentControlGraphStateChange.some(
          (state) => state.terminalReason === 'loop_detected',
        ),
      ).toBe(true);
    });

    it('should stop repeated expo project discovery after a few identical results', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        toolCall: { id: 'tc', name: 'expo_eas_list_projects', arguments: '{}' },
      };

      for (let i = 0; i < 6; i++) {
        mockStreamMessage.mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: '' },
            toolCallEvent,
            { type: 'done', content: '' },
          ]),
        );
      }

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Inspect Expo projects and continue',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['expo_eas_list_projects']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(6);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('should stop repeated tool_catalog discovery after a few identical category results', async () => {
      (executeTool as jest.Mock).mockResolvedValue(
        JSON.stringify({
          mode: 'category',
          category: 'browser',
          tools: [{ name: 'browser_navigate', description: 'Navigate browser pages.' }],
        }),
      );

      const toolCallEvent = {
        type: 'tool_call',
        toolCall: { id: 'tc', name: 'tool_catalog', arguments: '{"category":"browser"}' },
      };

      for (let i = 0; i < 6; i++) {
        mockStreamMessage.mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: '' },
            toolCallEvent,
            { type: 'done', content: '' },
          ]),
        );
      }

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-tool-catalog-loop',
        systemPrompt: 'sys',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Find the right browser capability and continue',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['tool_catalog']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(6);
      expect(callbacks.onDone).toHaveBeenCalled();
    });
  });
});
