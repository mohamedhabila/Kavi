// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 1
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
  describe('Tool call handling part 1', () => {
    it('should execute tool calls and continue the loop', async () => {
      // First iteration: tool call
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: '' },
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      // Second iteration: final text response
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'The file says: tool result' },
          { type: 'done', content: 'The file says: tool result' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledWith(
        'read_file',
        '{"path":"test.txt"}',
        'conv1',
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'test' }),
          model: 'gpt-5.4',
        }),
      );
      expect(callbacks.onToolCallStart).toHaveBeenCalled();
      expect(callbacks.onToolCallComplete).toHaveBeenCalled();
      expect(callbacks.calls.onAssistantMessage).toHaveLength(2);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('deduplicates one logical tool call when streaming metadata upgrades its id mid-turn', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'fc_1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
              raw: {
                id: 'fc_1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.txt"}',
                },
                _openai: {
                  itemId: 'fc_1',
                  outputIndex: 0,
                },
              },
            },
          },
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
              raw: {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.txt"}',
                },
                _openai: {
                  itemId: 'fc_1',
                  callId: 'call_1',
                  outputIndex: 0,
                },
              },
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'The file says: tool result' },
          { type: 'done', content: 'The file says: tool result' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-logical-tool-upgrade',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledWith(
        'read_file',
        '{"path":"test.txt"}',
        'conv-logical-tool-upgrade',
        expect.objectContaining({ model: 'gpt-5.4' }),
      );
      expect(callbacks.calls.onAssistantMessage[0].toolCalls).toEqual([
        expect.objectContaining({
          id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"test.txt"}',
        }),
      ]);
      expect(callbacks.calls.onToolCallStart).toHaveLength(1);
      expect(callbacks.calls.onToolCallStart[0]).toEqual(expect.objectContaining({ id: 'call_1' }));
      expect(callbacks.calls.onToolMessage).toEqual([
        expect.objectContaining({ id: 'call_1', result: 'tool result' }),
      ]);
    });

    it('waits for tool-result persistence before the next model request', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
            },
          },
          { type: 'done', content: '' },
        ]),
      );
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'The file says: tool result' },
          { type: 'done', content: 'The file says: tool result' },
        ]),
      );

      let releaseToolPersistence: (() => void) | undefined;
      const toolPersistenceReleased = new Promise<void>((resolve) => {
        releaseToolPersistence = resolve;
      });
      let markToolMessageStarted: (() => void) | undefined;
      const toolMessageStarted = new Promise<void>((resolve) => {
        markToolMessageStarted = resolve;
      });

      const callbacks = makeCallbacks();
      callbacks.onToolMessage = jest.fn(async (id, result) => {
        callbacks.calls.onToolMessage.push({ id, result });
        markToolMessageStarted?.();
        await toolPersistenceReleased;
      });

      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-tool-result-barrier',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      const runPromise = runOrchestrator(options, callbacks);
      await toolMessageStarted;

      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      releaseToolPersistence?.();
      await runPromise;

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      const secondRequestMessages = mockStreamMessage.mock.calls[1][0];
      expect(secondRequestMessages.some((message: any) => message.role === 'tool')).toBe(true);
    });

    it('streams direct text before a tool-capable turn completes', async () => {
      let releaseCompletion: (() => void) | undefined;

      mockStreamMessage.mockImplementationOnce(() =>
        (async function* () {
          yield { type: 'token', content: 'Hello' };
          await new Promise<void>((resolve) => {
            releaseCompletion = resolve;
          });
          yield { type: 'done', content: 'Hello' };
        })(),
      );

      const callbacks = makeCallbacks();
      let resolveFirstToken: (() => void) | undefined;
      const firstTokenSeen = new Promise<void>((resolve) => {
        resolveFirstToken = resolve;
      });
      const originalOnToken = callbacks.onToken;
      callbacks.onToken = jest.fn((token: string) => {
        (originalOnToken as jest.Mock)(token);
        resolveFirstToken?.();
      });

      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-streaming',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Answer directly', timestamp: Date.now() }],
      };

      const runPromise = runOrchestrator(options, callbacks);

      await firstTokenSeen;

      expect(callbacks.calls.onToken).toEqual(['Hello']);
      expect(callbacks.calls.onAssistantMessage).toHaveLength(0);
      expect(callbacks.onDone).not.toHaveBeenCalled();

      releaseCompletion?.();
      await runPromise;

      expect(callbacks.calls.onAssistantMessage[0]).toEqual({
        content: 'Hello',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
    });

    it('rejects incomplete tool-call emission before executing partial tool calls', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'partial-attempt' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-incomplete',
              name: 'read_file',
              arguments: '{"path":"partial',
            },
          },
          {
            type: 'done',
            content: '',
            completion: {
              completionStatus: 'incomplete',
              finishReason: 'stream_ended_without_done_marker',
            },
          },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).not.toHaveBeenCalled();
      expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
      expect(callbacks.calls.onError[0].message).toContain('Partial tool calls were discarded');
      expect(callbacks.calls.onError[0].message).toContain('stream_ended_without_done_marker');
      expect(callbacks.calls.onToken).toContain('partial-attempt');
      expect(callbacks.calls.onAssistantStreamReset).toHaveLength(1);
      expect(callbacks.getVisibleTokenText()).toBe('');
      expect(callbacks.calls.onAssistantMessage).toHaveLength(0);
      expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
      expect(callbacks.onDone).toHaveBeenCalled();
    });
  });
});
