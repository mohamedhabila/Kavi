// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 2
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  collectScopedToolResults,
  executeTool,
  mockStreamMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Tool call handling part 2', () => {
    it('retries token-exhausted tool-call emission before executing tools', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'discarded-attempt' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-retry',
              name: 'read_file',
              arguments: '{"path":"partial',
            },
          },
          {
            type: 'done',
            content: '',
            completion: {
              completionStatus: 'incomplete',
              finishReason: 'max_tokens',
            },
          },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'retried-attempt' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-retry',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
            },
          },
          {
            type: 'done',
            content: '',
            completion: {
              completionStatus: 'complete',
              finishReason: 'tool_use',
            },
          },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'final-answer' },
          { type: 'done', content: 'final-answer' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-retry',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
        maxTokens: 4096,
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(3);
      expect(mockStreamMessage.mock.calls[0][1].maxTokens).toBe(4096);
      expect(mockStreamMessage.mock.calls[1][1].maxTokens).toBeGreaterThan(
        mockStreamMessage.mock.calls[0][1].maxTokens,
      );
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledWith(
        'read_file',
        '{"path":"test.txt"}',
        'conv-retry',
        expect.objectContaining({ model: 'gpt-5.4' }),
      );
      expect(callbacks.calls.onToken).toContain('discarded-attempt');
      expect(callbacks.calls.onToken).toContain('retried-attempt');
      expect(callbacks.calls.onToken).toContain('final-answer');
      expect(callbacks.calls.onAssistantStreamReset).toHaveLength(1);
      expect(callbacks.getVisibleTokenText()).toBe('retried-attemptfinal-answer');
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('replays Gemini tool calls with preserved thought signatures', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
              raw: {
                id: 'tc1',
                type: 'function',
                extra_content: {
                  google: {
                    thought_signature: 'sig-A',
                  },
                },
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.txt"}',
                },
              },
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-3-flash-preview',
        }),
        model: 'gemini-3-flash-preview',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      const secondApiMessages = mockStreamMessage.mock.calls[1][0];
      const assistantReplay = secondApiMessages.find(
        (message: any) => message.role === 'assistant',
      );
      const toolReplay = secondApiMessages.find((message: any) => message.role === 'tool');

      expect(assistantReplay.tool_calls[0].extra_content.google.thought_signature).toBe('sig-A');
      expect(toolReplay).toMatchObject({
        role: 'tool',
        tool_call_id: 'tc1',
        name: 'read_file',
        content: 'tool result',
      });
      expect(callbacks.calls.onToolCallStart[0]).toMatchObject({
        id: 'tc1',
        name: 'read_file',
        raw: {
          extra_content: {
            google: {
              thought_signature: 'sig-A',
            },
          },
        },
      });
    });

    it('refuses unsigned Gemini tool turns instead of fabricating replay metadata', async () => {
      const missingSignatureToolTurn = () =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
              raw: {
                id: 'tc1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.txt"}',
                },
              },
            },
          },
          { type: 'done', content: '' },
        ]);

      mockStreamMessage.mockImplementation(missingSignatureToolTurn);

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-3-flash-preview',
        }),
        model: 'gemini-3-flash-preview',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).not.toHaveBeenCalled();
      expect(mockStreamMessage).toHaveBeenCalledTimes(5);
      expect(callbacks.onError).toHaveBeenCalled();
      expect(callbacks.calls.onError[0].message).toContain(
        'missing required provider replay coverage',
      );
    });

    it('leaves replayed Gemini tool calls unchanged when exact metadata is missing', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const now = Date.now();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-3-flash-preview',
        }),
        model: 'gemini-3-flash-preview',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'u1', role: 'user', content: 'Read both files', timestamp: now },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: now + 1,
            toolCalls: [
              { id: 'tc1', name: 'read_file', arguments: '{"path":"a.txt"}', status: 'completed' },
              { id: 'tc2', name: 'read_file', arguments: '{"path":"b.txt"}', status: 'completed' },
            ],
          },
          {
            id: 't1',
            role: 'tool',
            content: 'Error: a missing',
            toolCallId: 'tc1',
            timestamp: now + 2,
            isError: true,
          },
          {
            id: 't2',
            role: 'tool',
            content: 'Error: b missing',
            toolCallId: 'tc2',
            timestamp: now + 3,
            isError: true,
          },
          {
            id: 'u2',
            role: 'user',
            content: 'Read both files again and retry',
            timestamp: now + 4,
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const firstApiMessages = mockStreamMessage.mock.calls[0][0];
      const assistantReplay = firstApiMessages.find((message: any) => message.role === 'assistant');

      expect(assistantReplay.tool_calls).toHaveLength(2);
      expect(
        assistantReplay.tool_calls[0].extra_content?.google?.thought_signature,
      ).toBeUndefined();
      expect(
        assistantReplay.tool_calls[1].extra_content?.google?.thought_signature,
      ).toBeUndefined();
    });

    it('should handle tool execution failure', async () => {
      (executeTool as jest.Mock).mockRejectedValueOnce(new Error('Permission denied'));

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
          { type: 'token', content: 'Sorry, failed' },
          { type: 'done', content: 'Sorry, failed' },
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
      expect(completedCall.error).toBe('Permission denied');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('treats error-like tool result strings as failed outcomes', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(
        'Error: HTTP 403: access denied by the configured credential.',
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"secret.txt"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Blocked by credentials.' },
          { type: 'done', content: 'Blocked by credentials.' },
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
      expect(completedCall.error).toContain('HTTP 403');
      expect(
        collectScopedToolResults([
          {
            id: 'tool-msg',
            role: 'tool',
            content: completedCall.result,
            toolCallId: completedCall.id,
            toolCalls: [completedCall],
            isError: true,
            timestamp: Date.now(),
          },
        ]),
      ).toEqual([
        expect.objectContaining({
          toolName: 'read_file',
          status: 'failed',
        }),
      ]);
    });
  });
});
