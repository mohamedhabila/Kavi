// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 3
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  collectScopedToolResults,
  selectWorkflowScopedMessagesForRun,
  executeTool,
  mockStreamMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  expectFinalCandidateGraphBeforeDone,
  createStreamGenerator,
  type OrchestratorOptions,
  type Message,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Tool call handling part 3', () => {
    it('scopes workflow replay evidence to the active run user message', () => {
      const messages: Message[] = [
        { id: 'u1', role: 'user', content: 'Previous task', timestamp: 1 },
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'old-tc',
              name: 'skill__github__commit_files',
              arguments: '{}',
              status: 'completed',
              result: '{"commitSha":"old"}',
            },
          ],
        },
        {
          id: 'old-tool',
          role: 'tool',
          content: '{"commitSha":"old"}',
          toolCallId: 'old-tc',
          timestamp: 3,
          toolCalls: [
            {
              id: 'old-tc',
              name: 'skill__github__commit_files',
              arguments: '{}',
              status: 'completed',
              result: '{"commitSha":"old"}',
            },
          ],
        },
        { id: 'u2', role: 'user', content: 'New task', timestamp: 4 },
      ];

      expect(collectScopedToolResults(selectWorkflowScopedMessagesForRun(messages, 'u2'))).toEqual(
        [],
      );
      expect(collectScopedToolResults(selectWorkflowScopedMessagesForRun(messages, 'u1'))).toEqual([
        expect.objectContaining({
          toolName: 'skill__github__commit_files',
          status: 'completed',
        }),
      ]);
    });

    it('runs eligible read-only tool batches in parallel', async () => {
      const resolvers: Array<(value: string) => void> = [];
      (executeTool as jest.Mock).mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolvers.push(resolve);
          }),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
          {
            type: 'tool_call',
            toolCall: { id: 'tc2', name: 'glob_search', arguments: '{"pattern":"src/**/*.ts"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Finished' },
          { type: 'done', content: 'Finished' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-parallel',
        systemPrompt: 'sys',
        messages: [
          { id: 'msg1', role: 'user', content: 'Inspect the repo', timestamp: Date.now() },
        ],
        toolFilter: allowTools(['read_file', 'glob_search']),
      };

      const runPromise = runOrchestrator(options, callbacks);

      for (
        let attempt = 0;
        attempt < 8 && (executeTool as jest.Mock).mock.calls.length < 2;
        attempt += 1
      ) {
        // The orchestrator yields once after assistant tool-call emission and
        // once again for each running tool so the mobile UI can paint
        // pending/running state before the tool work starts.
        await new Promise((resolve) => setTimeout(resolve, 16));
      }

      expect(executeTool).toHaveBeenCalledTimes(2);

      resolvers[0]('file contents');
      resolvers[1]('search results');

      await runPromise;

      expect(callbacks.calls.onToolCallStart).toHaveLength(2);
      expect(callbacks.calls.onToolCallComplete).toHaveLength(2);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('keeps dynamic MCP tool batches sequential by default', async () => {
      const { mcpManager } = jest.requireMock('../../../src/services/mcp/manager') as {
        mcpManager: { getAllToolDefinitions: jest.Mock };
      };
      mcpManager.getAllToolDefinitions.mockReturnValueOnce([
        {
          name: 'mcp__docs__fetch',
          description: 'Fetch docs',
          parameters: { type: 'object', properties: {} },
        },
      ]);

      const resolvers: Array<(value: string) => void> = [];
      (executeTool as jest.Mock).mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolvers.push(resolve);
          }),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'mcp__docs__fetch', arguments: '{"path":"/a"}' },
          },
          {
            type: 'tool_call',
            toolCall: { id: 'tc2', name: 'mcp__docs__fetch', arguments: '{"path":"/b"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Finished' },
          { type: 'done', content: 'Finished' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-dynamic-tools',
        systemPrompt: 'sys',
        messages: [
          { id: 'msg1', role: 'user', content: 'Inspect the docs', timestamp: Date.now() },
        ],
        toolFilter: allowTools(['mcp__docs__fetch']),
      };

      const runPromise = runOrchestrator(options, callbacks);

      for (
        let attempt = 0;
        attempt < 8 && (executeTool as jest.Mock).mock.calls.length < 1;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 16));
      }

      expect(executeTool).toHaveBeenCalledTimes(1);

      resolvers[0]('first result');

      for (
        let attempt = 0;
        attempt < 8 && (executeTool as jest.Mock).mock.calls.length < 2;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 16));
      }

      expect(executeTool).toHaveBeenCalledTimes(2);

      resolvers[1]('second result');

      await runPromise;

      expect(callbacks.calls.onToolCallStart).toHaveLength(2);
      expect(callbacks.calls.onToolCallComplete).toHaveLength(2);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('drops tool calls that appear after sessions_yield in the same assistant turn', async () => {
      (executeTool as jest.Mock).mockImplementationOnce(async (toolName: string) => {
        expect(toolName).toBe('sessions_yield');
        return JSON.stringify({
          status: 'completed',
          message: 'All workers are done.',
          finalizeSupervisor: true,
          pendingSessions: [],
        });
      });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-yield',
              name: 'sessions_yield',
              arguments: '{"message":"checkpoint"}',
            },
          },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-extra',
              name: 'read_file',
              arguments: '{"path":"after-yield.txt"}',
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Finalized after yield.' },
          { type: 'done', content: 'Finalized after yield.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-yield',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'msg1', role: 'user', content: 'Monitor the workers', timestamp: Date.now() },
        ],
        toolFilter: allowTools(['sessions_yield', 'read_file']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledWith(
        'sessions_yield',
        '{"message":"checkpoint"}',
        'conv-yield',
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'test' }),
          model: 'gpt-5.4',
        }),
      );
      expect(callbacks.calls.onAssistantMessage[0].toolCalls).toEqual([
        expect.objectContaining({ id: 'tc-yield', name: 'sessions_yield' }),
      ]);
      expect(callbacks.calls.onToolMessage).toEqual([expect.objectContaining({ id: 'tc-yield' })]);
      expect(callbacks.calls.onAssistantMessage[1]).toEqual(
        expect.objectContaining({
          content: 'Finalized after yield.',
        }),
      );
      expectFinalCandidateGraphBeforeDone(callbacks);
    });

    it('should require tool use for actionable workspace requests on the first turn', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Inspecting' },
          { type: 'done', content: 'Inspecting' },
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
            content: 'Read src/App.tsx and fix the issue',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalled();
      expect(mockStreamMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({ toolChoice: undefined }),
      );
    });

    it('keeps Anthropic thinking enabled on coder-style turns by leaving tool use optional', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Inspecting' },
          { type: 'done', content: 'Inspecting' },
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
        conversationId: 'conv-anthropic-coder',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Read src/App.tsx and fix the issue',
            timestamp: Date.now(),
          },
        ],
        thinkingLevel: 'high',
      };

      await runOrchestrator(options, callbacks);

      const [, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(streamOptions.toolChoice).toBeUndefined();
      expect(streamOptions.tools?.length).toBeGreaterThan(0);
      expect(streamOptions.thinking).toEqual({ type: 'adaptive' });
      expect(streamOptions.output_config).toEqual({ effort: 'high' });
      expect(streamOptions.temperature).toBeUndefined();
    });
  });
});
