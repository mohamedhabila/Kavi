// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 6
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  executeTool,
  getSkillSystemPrompts,
  memoryAccessGateway,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Tool call handling part 6', () => {
    it('ignores trailing internal slash control prompts during slash-command interception', async () => {
      const parserModule = jest.requireMock('../../../src/services/commands/parser') as {
        isSlashCommand: jest.Mock;
        parseCommand: jest.Mock;
      };
      const builtinsModule = jest.requireMock('../../../src/services/commands/builtins') as {
        getCommand: jest.Mock;
      };

      parserModule.isSlashCommand.mockImplementation((content: string) => content.startsWith('/'));
      parserModule.parseCommand.mockReturnValue({ name: 'status', args: '' });
      const slashHandler = jest.fn().mockResolvedValue({ response: 'slash result' });
      builtinsModule.getCommand.mockReturnValue({ handler: slashHandler });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'normal assistant response' },
          { type: 'done', content: 'normal assistant response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-ignore-internal-slash',
        systemPrompt: 'You are helpful',
        internalUserMessageCount: 1,
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'What is the current weather in Cairo?',
            timestamp: 1_000,
          },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Draft answer pending verification.',
            timestamp: 1_100,
          },
          { id: 'msg3', role: 'user', content: '/status', timestamp: 1_200 },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(slashHandler).not.toHaveBeenCalled();
      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      expect(
        callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1],
      ).toEqual(
        expect.objectContaining({
          content: 'normal assistant response',
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });

    it('uses a conservative scoped fallback when unified memory access is unavailable', async () => {
      const registryModule = jest.requireMock('../../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      const skillsModule = jest.requireMock('../../../src/services/skills/manager') as {
        getSkillToolDefinitions: jest.Mock;
      };

      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });
      skillsModule.getSkillToolDefinitions.mockReturnValueOnce([
        {
          name: 'weather_current',
          description: 'Get the current outdoor weather and temperature for a location.',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
            additionalProperties: false,
          },
        },
      ]);

      const memoryAccessSpy = jest
        .spyOn(memoryAccessGateway, 'buildUnifiedMemoryAccessContext')
        .mockRejectedValueOnce(new Error('memory gateway unavailable'));

      (executeTool as jest.Mock).mockResolvedValueOnce('Cairo weather: 14 C and clear.');

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'weather_current', arguments: '{"location":"Cairo"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'It is about 14 C and clear in Cairo.' },
          { type: 'done', content: 'It is about 14 C and clear in Cairo.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-fallback-weather',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        internalUserMessageCount: 1,
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Design a full architecture rewrite plan for the app.',
            timestamp: 1_000,
          },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Here is the architecture plan draft.',
            timestamp: 2_000,
          },
          {
            id: 'msg3',
            role: 'user',
            content: 'Is it cold outside in Cairo right now?',
            timestamp: 30_000_000,
          },
          {
            id: 'msg4',
            role: 'assistant',
            content: 'Draft answer pending stronger verification.',
            timestamp: 30_000_001,
          },
          {
            id: 'msg5',
            role: 'user',
            content: 'Continue the already-visible answer. Close pilot gaps without restarting.',
            timestamp: 30_000_002,
          },
        ],
      };

      try {
        await runOrchestrator(options, callbacks);
      } finally {
        memoryAccessSpy.mockRestore();
      }

      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      expect(systemPromptMessage.content).toContain(
        'Runtime: mobile (React Native / Expo), channel mobile-app.',
      );
      expect(getSkillSystemPrompts).toHaveBeenCalledWith('conv-super-agent-fallback-weather');
    });

    it('allows SuperAgent to finalize a non-trivial solo-tool run when no delegated worker was requested', async () => {
      const registryModule = jest.requireMock('../../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });

      (executeTool as jest.Mock).mockResolvedValueOnce('file contents');

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"src/App.tsx"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'I already have enough to answer directly.' },
          { type: 'done', content: 'I already have enough to answer directly.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-delegation',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Inspect src/App.tsx, verify the issue, and report back.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(
        callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1],
      ).toEqual({
        content: 'I already have enough to answer directly.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
    });

    it('does not force SuperAgent to relaunch delegation after a failed worker launch', async () => {
      const registryModule = jest.requireMock('../../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });

      (executeTool as jest.Mock)
        .mockResolvedValueOnce(
          JSON.stringify({
            status: 'error',
            error: 'Worker launch failed.',
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            status: 'completed',
            sessionId: 'sub-2',
            outputPreview: 'Worker verified the fix.',
          }),
        );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc1',
              name: 'sessions_spawn',
              arguments: '{"prompt":"Verify the fix"}',
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'I can answer anyway.' },
          { type: 'done', content: 'I can answer anyway.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-retry-delegation',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Verify the issue with a worker and then report back.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(
        callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1],
      ).toEqual({
        content: 'I can answer anyway.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
    });
  });
});
