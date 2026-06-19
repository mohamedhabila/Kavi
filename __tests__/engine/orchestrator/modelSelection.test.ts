// ---------------------------------------------------------------------------
// Tests - Orchestrator: Model selection
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  createInitialAgentControlGraphSnapshot,
  collectScopedToolResults,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  expectTerminalGraphBeforeSequenceEntry,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Model selection', () => {
    it('replays tool results by resolving prior tool-call ids when result messages omit embedded calls', () => {
      const results = collectScopedToolResults([
        {
          id: 'u1',
          role: 'user',
          content: 'Continue',
          timestamp: 1000,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          timestamp: 1100,
          toolCalls: [
            {
              id: 'call-1',
              name: 'skill__remote__inspect',
              arguments: '{"target":"service"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 't1',
          role: 'tool',
          content: '{"status":"ok"}',
          toolCallId: 'call-1',
          timestamp: 1200,
        },
      ]);

      expect(results).toEqual([
        {
          toolName: 'skill__remote__inspect',
          result: '{"status":"ok"}',
          status: 'completed',
          timestamp: 1200,
          argumentsText: '{"target":"service"}',
        },
      ]);
    });

    it('keeps the requested model on later tool-follow-up turns by default', async () => {
      let callCount = 0;
      mockStreamMessage.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
            },
            { type: 'done' },
          ]);
        }

        return createStreamGenerator([{ type: 'token', content: 'done' }, { type: 'done' }]);
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          model: 'gpt-5.4-mini',
          availableModels: ['gpt-5.4-mini'],
        }),
        model: 'gpt-5.4',
        conversationId: 'conv-model-lock',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read test.txt', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(mockStreamMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({ model: 'gpt-5.4' }),
      );
      expect(mockStreamMessage.mock.calls[1][1]).toEqual(
        expect.objectContaining({ model: 'gpt-5.4' }),
      );
    });

    it('repairs missing persisted tool-result messages before a resumed model request', async () => {
      mockStreamMessage.mockReturnValue(
        createStreamGenerator([{ type: 'token', content: 'done' }, { type: 'done' }]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-repair-tool-results',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'u1', role: 'user', content: 'Continue', timestamp: Date.now() },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            toolCalls: [
              {
                id: 'gemini-call-0',
                name: 'read_file',
                arguments: '{"path":"a.txt"}',
                status: 'completed',
                result: 'first result',
              },
            ],
          },
          {
            id: 'a2',
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            toolCalls: [
              {
                id: 'gemini-call-0',
                name: 'text_search',
                arguments: '{"query":"needle"}',
                status: 'completed',
                result: 'second result',
              },
            ],
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const requestMessages = mockStreamMessage.mock.calls[0][0];
      const toolMessages = requestMessages.filter((message: any) => message.role === 'tool');
      expect(toolMessages.map((message: any) => message.content)).toEqual([
        'first result',
        'second result',
      ]);
      expect(toolMessages.map((message: any) => message.name)).toEqual([
        'read_file',
        'text_search',
      ]);
    });

    it('does not re-enter the model when the restored control graph is already terminal', async () => {
      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-terminal-graph-noop',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'u1', role: 'user', content: 'Continue', timestamp: Date.now() }],
        initialAgentControlGraphState: createInitialAgentControlGraphSnapshot({
          status: 'failed',
          terminalReason: 'preexisting_failure',
          updatedAt: 1234,
        }),
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).not.toHaveBeenCalled();
      expect(callbacks.calls.onAssistantMessage).toEqual([]);
      expect(callbacks.calls.onError).toEqual([]);
      expect(callbacks.calls.onStateChange).toEqual(['thinking', 'idle']);
      expect(callbacks.calls.onAgentControlGraphStateChange.at(-1)).toEqual(
        expect.objectContaining({
          status: 'failed',
          terminalReason: 'preexisting_failure',
        }),
      );
      expect(callbacks.calls.onDone).toHaveLength(1);
    });

    it('publishes durable control graph snapshots across model and tool boundaries', async () => {
      let callCount = 0;
      mockStreamMessage.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: { id: 'call-read', name: 'read_file', arguments: '{"path":"test.txt"}' },
            },
            { type: 'done' },
          ]);
        }

        return createStreamGenerator([
          { type: 'token', content: 'done' },
          { type: 'done', completion: { finishReason: 'stop', completionStatus: 'complete' } },
        ]);
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-control-graph',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read test.txt', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const snapshots = callbacks.calls.onAgentControlGraphStateChange;
      expect(snapshots.map((snapshot) => snapshot.status)).toEqual(
        expect.arrayContaining(['ready', 'model_turn', 'awaiting_tool_results', 'awaiting_review']),
      );
      expect(
        snapshots.some(
          (snapshot) =>
            snapshot.status === 'awaiting_tool_results' &&
            snapshot.expectedToolCalls.some((call) => call.id === 'call-read'),
        ),
      ).toBe(true);
      expect(snapshots[snapshots.length - 1]).toEqual(
        expect.objectContaining({
          status: 'awaiting_review',
          expectedToolCalls: [],
          observedToolResults: [],
        }),
      );
    });

    it('hydrates persisted control graph state before allowing a resumed model turn', async () => {
      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-control-graph-resume',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Continue', timestamp: Date.now() }],
        initialAgentControlGraphState: {
          version: 1,
          status: 'awaiting_tool_results',
          iteration: 3,
          expectedToolCalls: [{ id: 'call-missing', name: 'generic_external_tool' }],
          observedToolResults: [],
          pendingAsyncCount: 0,
          lastModelToolNames: ['generic_external_tool'],
          audit: [],
          updatedAt: 1234,
        },
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).not.toHaveBeenCalled();
      expect(callbacks.calls.onAgentControlGraphStateChange[0]).toEqual(
        expect.objectContaining({
          status: 'awaiting_tool_results',
          expectedToolCalls: [{ id: 'call-missing', name: 'generic_external_tool' }],
        }),
      );
      expect(callbacks.calls.onError[0]).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('waiting for tool result(s): call-missing'),
        }),
      );
      expect(callbacks.calls.onAgentControlGraphStateChange.at(-1)).toEqual(
        expect.objectContaining({
          status: 'failed',
          expectedToolCalls: [],
          observedToolResults: [],
        }),
      );
      expectTerminalGraphBeforeSequenceEntry(callbacks, 'failed', 'error');
    });

    it('does not persist phantom expected tool calls when incomplete tool-call emission is discarded', async () => {
      mockStreamMessage.mockImplementation(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'partial-call',
              name: 'write_file',
              arguments: '{"path":"draft',
            },
          },
          {
            type: 'done',
            completion: {
              completionStatus: 'incomplete',
              finishReason: 'max_tokens',
            },
          },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-incomplete-tool-call-emission',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Write a file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.calls.onError[0]).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('ended before tool-call emission completed'),
        }),
      );
      expect(
        callbacks.calls.onAgentControlGraphStateChange.some(
          (snapshot) =>
            snapshot.status === 'awaiting_tool_results' &&
            snapshot.expectedToolCalls.some((call) => call.id === 'partial-call'),
        ),
      ).toBe(false);
      expect(callbacks.calls.onAgentControlGraphStateChange.at(-1)).toEqual(
        expect.objectContaining({
          status: 'failed',
          expectedToolCalls: [],
          observedToolResults: [],
        }),
      );
      expectTerminalGraphBeforeSequenceEntry(callbacks, 'failed', 'error');
    });
  });
});
