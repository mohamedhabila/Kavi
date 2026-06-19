// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 4
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
  describe('Tool call handling part 4', () => {
    it('keeps Anthropic thinking enabled on lightweight direct turns without forcing tool use', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Merge sort uses divide and conquer.' },
          { type: 'done', content: 'Merge sort uses divide and conquer.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        }),
        model: 'claude-sonnet-4-6',
        conversationId: 'conv-anthropic-thinking',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'msg1', role: 'user', content: 'Explain merge sort.', timestamp: Date.now() },
        ],
        thinkingLevel: 'high',
        temperature: 0.2,
      };

      await runOrchestrator(options, callbacks);

      const [, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(streamOptions.toolChoice).toBeUndefined();
      expect(streamOptions.maxTokens).toBe(32000);
      expect(streamOptions.tools).toEqual(expect.any(Array));
      expect(streamOptions.thinking).toEqual({ type: 'adaptive' });
      expect(streamOptions.output_config).toEqual({ effort: 'high' });
      expect(streamOptions.temperature).toBeUndefined();
    });

    it('replays Anthropic assistant blocks and keeps thinking enabled in a replayable tool loop', async () => {
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
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        }),
        model: 'claude-sonnet-4-6',
        conversationId: 'conv-anthropic-tool-loop',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'u1', role: 'user', content: 'Read notes.txt', timestamp: now },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: now + 1,
            providerReplay: {
              anthropicBlocks: [
                {
                  type: 'thinking',
                  thinking: 'I should inspect the file first.',
                  signature: 'sig-A',
                },
                {
                  type: 'tool_use',
                  id: 'toolu_1',
                  name: 'read_file',
                  input: { path: 'notes.txt' },
                },
              ],
            },
            toolCalls: [
              {
                id: 'toolu_1',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
                status: 'completed',
                raw: {
                  id: 'toolu_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                },
              },
            ],
          },
          {
            id: 't1',
            role: 'tool',
            content: 'file contents',
            toolCallId: 'toolu_1',
            timestamp: now + 2,
          },
        ],
        thinkingLevel: 'high',
        temperature: 0.2,
      };

      await runOrchestrator(options, callbacks);

      const [apiMessages, streamOptions] = mockStreamMessage.mock.calls[0];
      const assistantReplay = apiMessages.find((message: any) => message.role === 'assistant');

      expect(assistantReplay).toEqual({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(streamOptions.thinking).toEqual({ type: 'adaptive' });
      expect(streamOptions.output_config).toEqual({ effort: 'high' });
      expect(streamOptions.temperature).toBeUndefined();
    });

    it('replays Anthropic redacted thinking blocks and keeps thinking enabled in a replayable tool loop', async () => {
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
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        }),
        model: 'claude-sonnet-4-6',
        conversationId: 'conv-anthropic-redacted-tool-loop',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'u1', role: 'user', content: 'Read notes.txt', timestamp: now },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: now + 1,
            providerReplay: {
              anthropicBlocks: [
                { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
                {
                  type: 'tool_use',
                  id: 'toolu_1',
                  name: 'read_file',
                  input: { path: 'notes.txt' },
                },
              ],
            },
            toolCalls: [
              {
                id: 'toolu_1',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
                status: 'completed',
                raw: {
                  id: 'toolu_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                },
              },
            ],
          },
          {
            id: 't1',
            role: 'tool',
            content: 'file contents',
            toolCallId: 'toolu_1',
            timestamp: now + 2,
          },
        ],
        thinkingLevel: 'high',
        temperature: 0.2,
      };

      await runOrchestrator(options, callbacks);

      const [apiMessages, streamOptions] = mockStreamMessage.mock.calls[0];
      const assistantReplay = apiMessages.find((message: any) => message.role === 'assistant');

      expect(assistantReplay).toEqual({
        role: 'assistant',
        content: [
          { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(streamOptions.toolChoice).toBeUndefined();
      expect(streamOptions.thinking).toEqual({ type: 'adaptive' });
      expect(streamOptions.output_config).toEqual({ effort: 'high' });
      expect(streamOptions.temperature).toBeUndefined();
    });

    it('continues monitoring after sessions_yield records a checkpoint', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ status: 'checkpointed', message: 'Waiting for workers' }),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'sessions_yield', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      );
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Still monitoring workers.' },
          { type: 'done', content: 'Still monitoring workers.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Wait for the spawned agents',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['sessions_yield']),
      };

      await runOrchestrator(options, callbacks);

      expect(
        callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1],
      ).toEqual({
        content: 'Still monitoring workers.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
      expect(callbacks.onDone).toHaveBeenCalled();
      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    });

    it('forces a final text-only turn after sessions_yield reports no running workers remain', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          status: 'completed',
          message: 'Workers are finished',
          finalizeSupervisor: true,
          pendingSessions: [],
        }),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'sessions_yield', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      );
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Final answer ready.' },
          { type: 'done', content: 'Final answer ready.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Wait for the spawned agents',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['sessions_yield']),
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(mockStreamMessage.mock.calls[1][1].tools).toBeUndefined();
      expect(
        callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1],
      ).toEqual({
        content: 'Final answer ready.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
      expect(callbacks.calls.onToolMessage[0]).toEqual(
        expect.objectContaining({
          result: expect.stringContaining('"finalizeSupervisor":true'),
        }),
      );
    });

    it('should require another tool after a monitoring tool result', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'tool_catalog', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Still working' },
          { type: 'done', content: 'Still working' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Find the right tools and continue',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage.mock.calls[1][1]).toEqual(
        expect.objectContaining({ toolChoice: undefined }),
      );
    });
  });
});
