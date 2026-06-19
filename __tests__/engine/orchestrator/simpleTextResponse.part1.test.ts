// ---------------------------------------------------------------------------
// Tests - Orchestrator: Simple text response part 1
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  MAX_TOOL_ITERATIONS,
  executeTool,
  getSkillSystemPrompts,
  mockStreamMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  expectTerminalGraphBeforeDone,
  expectFinalCandidateGraphBeforeDone,
  createStreamGenerator,
  expectAssistantMetadata,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Simple text response part 1', () => {
    it('should handle a simple text response without tool calls', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Hello' },
          { type: 'token', content: ' world' },
          { type: 'done', content: 'Hello world' },
        ]),
      );

      const callbacks = makeCallbacks();
      callbacks.onUserMessageEnriched = jest.fn();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hi', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('thinking');
      expect(callbacks.onStateChange).toHaveBeenCalledWith('responding');
      expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
      expect(callbacks.calls.onToken).toEqual(['Hello', ' world']);
      expect(callbacks.calls.onAssistantMessage).toEqual([
        {
          content: 'Hello world',
          toolCalls: [],
          providerReplay: undefined,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
          },
        },
      ]);
      expect(callbacks.onDone).toHaveBeenCalled();
      expectFinalCandidateGraphBeforeDone(callbacks);
    });

    it('records terminal graph state before max-iteration closeout', async () => {
      (executeTool as jest.Mock).mockImplementation(
        async (_toolName: string, args: string) => `tool result for ${args}`,
      );
      for (let index = 0; index < MAX_TOOL_ITERATIONS; index += 1) {
        const toolName = index % 2 === 0 ? 'read_file' : 'list_files';
        const toolArguments =
          toolName === 'read_file'
            ? `{"path":"max-${index}.txt"}`
            : `{"path":"artifacts/max-${index}"}`;
        mockStreamMessage.mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: {
                id: `tc-max-${index}`,
                name: toolName,
                arguments: toolArguments,
              },
            },
            { type: 'done', content: '' },
          ]),
        );
      }

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-max-terminal-graph',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Keep inspecting files',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['read_file', 'list_files']),
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
      expectAssistantMetadata(callbacks.calls.onAssistantMessage.at(-1)?.assistantMetadata, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'max_iterations',
      });
      expectTerminalGraphBeforeDone(callbacks, 'finalized', 'max_iterations');
    });

    it('marks non-resumable incomplete terminal text responses as incomplete final answers', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Partial answer' },
          {
            type: 'done',
            content: 'Partial answer',
            completion: { completionStatus: 'incomplete', finishReason: 'content_filter' },
          },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hi', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.calls.onAssistantMessage).toHaveLength(1);
      expect(callbacks.calls.onAssistantMessage[0].content).toBe('Partial answer');
      expectAssistantMetadata(callbacks.calls.onAssistantMessage[0].assistantMetadata, {
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'content_filter',
      });
    });

    it('continues recoverable incomplete final text turns before finalizing', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Partial answer' },
          {
            type: 'done',
            content: 'Partial answer',
            completion: { completionStatus: 'incomplete', finishReason: 'length' },
          },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: ' continued cleanly.' },
          {
            type: 'done',
            content: ' continued cleanly.',
            completion: { completionStatus: 'complete', finishReason: 'stop' },
          },
        ]),
      );

      const callbacks = makeCallbacks();
      callbacks.onUserMessageEnriched = jest.fn();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
        }),
        model: 'gpt-5.4',
        conversationId: 'conv-incomplete-final',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'msg1', role: 'user', content: 'Finish the final answer', timestamp: Date.now() },
        ],
        maxTokens: 4096,
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(mockStreamMessage.mock.calls[1][1].tools).toBeUndefined();
      expect(mockStreamMessage.mock.calls[1][1].maxTokens).toBeGreaterThan(
        mockStreamMessage.mock.calls[0][1].maxTokens,
      );
      expect(callbacks.calls.onAssistantMessage).toEqual([
        {
          content: 'Partial answer continued cleanly.',
          toolCalls: [],
          providerReplay: undefined,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        },
      ]);
      expect(callbacks.calls.onError).toHaveLength(0);
    });

    it('uses persisted enriched user content when formatting API messages', async () => {
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
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Check https://example.com',
            enrichedContent:
              'Check https://example.com\n\n<link_context>Full extracted article</link_context>',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[1]).toMatchObject({ role: 'user' });
      expect(apiMessages[1].content).toContain(
        '<link_context>Full extracted article</link_context>',
      );
      expect(apiMessages[1].content).not.toContain('<runtime_context>');
      expect(apiMessages[0].content).toContain('<runtime_context>');
      expect(apiMessages[0].content).toContain('request_timestamp_utc:');
    });

    it('preserves prior topic history before budget pressure in the one-conversation chat path', async () => {
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
        conversationId: 'conv-topic-boundary',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'old-user',
            role: 'user',
            content: 'Plan my beach vacation itinerary for July.',
            timestamp: 1_000,
          },
          {
            id: 'old-assistant',
            role: 'assistant',
            content: 'Here is your beach itinerary.',
            timestamp: 2_000,
          },
          {
            id: 'new-user',
            role: 'user',
            content: 'Fix the production migration mismatch in release workflow.',
            timestamp: 30_000_000,
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0] as Array<{
        role: string;
        content: string | Array<{ type: string; text?: string }>;
      }>;

      const flattened = apiMessages
        .map((message) =>
          typeof message.content === 'string'
            ? message.content
            : message.content
                .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
                .join('\n'),
        )
        .join('\n');

      expect(flattened).toContain('Fix the production migration mismatch in release workflow.');
      expect(flattened).toContain('Plan my beach vacation itinerary for July.');
      expect(getSkillSystemPrompts).toHaveBeenCalledWith('conv-topic-boundary');
    });

    it('includes non-image attachment metadata in API messages', async () => {
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
        conversationId: 'conv-attachments',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: '',
            attachments: [
              {
                id: 'att-1',
                type: 'file',
                uri: 'file:///report.pdf',
                name: 'report.pdf',
                mimeType: 'application/pdf',
                size: 2048,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[1].role).toBe('user');
      expect(apiMessages[0].content).toContain('<runtime_context>');
      expect(apiMessages[0].content).toContain('request_timestamp_utc:');
      expect(apiMessages[1].content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('report.pdf'),
          }),
        ]),
      );
    });
  });
});
