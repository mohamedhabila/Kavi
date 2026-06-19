// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 9
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  createInitialAgentControlGraphSnapshot,
  LlmService,
  executeTool,
  mockStreamMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Tool call handling part 9', () => {
    it('keeps python off the default hot surface while preserving read-only discovery', async () => {
      const mockSendMessage = jest.fn();
      (LlmService as any).mockImplementation(() => ({
        streamMessage: mockStreamMessage,
        sendMessage: mockSendMessage,
      }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Parsing with Python' },
          { type: 'done', content: 'Parsing with Python' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-2.5-pro',
        }),
        model: 'gemini-2.5-pro',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Run a Python script to parse this JSON and summarize the result.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(
        {
          ...options,
          initialAgentControlGraphState: createInitialAgentControlGraphSnapshot({
            goals: [
              {
                id: 'goal-python',
                title: 'Parse JSON with Python',
                status: 'active',
                dependencies: [],
                evidence: [],
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
        },
        callbacks,
      );

      const streamOptions = mockStreamMessage.mock.calls[0][1];
      const selectedToolNames = new Set((streamOptions.tools || []).map((tool: any) => tool.name));
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(selectedToolNames.has('python')).toBe(false);
      expect(selectedToolNames.has('tool_catalog')).toBe(true);
    });

    it('allows finalization after a single-tool execution produces evidence', async () => {
      const mockSendMessage = jest.fn();
      (LlmService as any).mockImplementation(() => ({
        streamMessage: mockStreamMessage,
        sendMessage: mockSendMessage,
      }));

      (executeTool as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          status: 'completed',
          output: 'KAVIASYNCOK',
        }),
      );

      mockStreamMessage
        .mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: {
                id: 'tc-python',
                name: 'python',
                arguments: '{"code":"print(\\"KAVIASYNCOK\\")"}',
              },
            },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: 'Verified KAVIASYNCOK.' },
            { type: 'done', content: 'Verified KAVIASYNCOK.' },
          ]),
        );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-2.5-pro',
        }),
        model: 'gemini-2.5-pro',
        conversationId: 'conv-python-finalizes-after-evidence',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content:
              'Run a Python script that prints KAVIASYNCOK, then report the verified output.',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['python']),
      };

      await runOrchestrator(options, callbacks);

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(callbacks.calls.onAssistantMessage.at(-1)?.content).toBe('Verified KAVIASYNCOK.');
    });

    it('adds timing metadata to running tool calls', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
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
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read the file', timestamp: Date.now() }],
        toolFilter: allowTools(['read_file']),
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.calls.onToolCallStart[0]).toEqual(
        expect.objectContaining({
          startedAt: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      );
      expect(callbacks.calls.onToolCallComplete[0]).toEqual(
        expect.objectContaining({
          completedAt: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      );
    });
  });
});
