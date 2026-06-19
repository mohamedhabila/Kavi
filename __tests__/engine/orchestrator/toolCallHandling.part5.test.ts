// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 5
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  executeTool,
  getSkillSystemPrompts,
  mockStreamMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Tool call handling part 5', () => {
    it('does not force a special closeout after an explicit non-blocking sessions_spawn launch', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          status: 'running',
          sessionId: 'sub-1',
          guidance: 'Poll sessions_status until the session reaches a terminal state.',
        }),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc1',
              name: 'sessions_spawn',
              arguments: '{"prompt":"Research this","waitForCompletion":false}',
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc2', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Worker completed successfully.' },
          { type: 'done', content: 'Worker completed successfully.' },
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
            content:
              'Create a worker, leave it running in the background, and report that it started.',
            timestamp: Date.now(),
          },
        ],
        toolFilter: allowTools(['sessions_spawn', 'sessions_status']),
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(2);
      expect(executeTool).toHaveBeenNthCalledWith(
        1,
        'sessions_spawn',
        '{"prompt":"Research this","waitForCompletion":false}',
        'conv1',
        expect.any(Object),
      );
      expect(executeTool).toHaveBeenNthCalledWith(
        2,
        'sessions_status',
        '{"sessionId":"sub-1"}',
        'conv1',
        expect.any(Object),
      );
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('falls back to the active provider and model when a persona resolves to an unavailable provider', async () => {
      const registryModule = jest.requireMock('../../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      const personasModule = jest.requireMock('../../../src/services/agents/personas') as {
        resolvePersonaModel: jest.Mock;
      };

      registryModule.getPersona.mockReturnValueOnce({
        id: 'reviewer',
        name: 'Reviewer',
        systemPrompt: 'You are the Reviewer.',
      });
      personasModule.resolvePersonaModel.mockReturnValueOnce({
        providerId: 'missing-provider',
        model: 'claude-sonnet-4-6',
      });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Validated.' },
          { type: 'done', content: 'Validated.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          availableModels: ['gpt-5.4', 'gpt-5.4-mini'],
        }),
        model: 'gpt-5.4-mini',
        conversationId: 'conv-persona-provider-fallback',
        systemPrompt: 'You are helpful',
        personaId: 'reviewer',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Validate the current setup.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      expect(mockStreamMessage.mock.calls[0][1]).toEqual(
        expect.objectContaining({ model: 'gpt-5.4-mini' }),
      );
    });

    it('keeps session coordination tools out of trivial direct SuperAgent turns', async () => {
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
          {
            type: 'token',
            content:
              'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.',
          },
          {
            type: 'done',
            content:
              'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.',
          },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-direct-weather',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Is it cold outside in Cairo right now?',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const firstTurnToolNames = mockStreamMessage.mock.calls[0][1].tools.map(
        (tool: { name: string }) => tool.name,
      );
      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      expect(
        firstTurnToolNames.filter(
          (name: string) =>
            name.startsWith('sessions_') && name !== 'sessions_spawn' && name !== 'sessions_wait',
        ),
      ).toEqual([]);
      expect(systemPromptMessage.content).toContain(
        'Runtime: mobile (React Native / Expo), channel mobile-app.',
      );
      expect(callbacks.getVisibleTokenText()).toBe(
        'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.',
      );
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('ignores internal resume control prompts when assessing the request and selecting tools', async () => {
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
          {
            type: 'token',
            content:
              'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.',
          },
          {
            type: 'done',
            content:
              'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.',
          },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-resume-weather',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        internalUserMessageCount: 1,
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Is it cold outside in Cairo right now?',
            timestamp: Date.now() - 10,
          },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Draft answer pending stronger verification.',
            timestamp: Date.now() - 5,
          },
          {
            id: 'msg3',
            role: 'user',
            content:
              'Continue the already-visible answer. Close the pilot gaps using the verified findings. Do not restart the answer.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const firstTurnToolNames = mockStreamMessage.mock.calls[0][1].tools.map(
        (tool: { name: string }) => tool.name,
      );
      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      expect(
        firstTurnToolNames.filter(
          (name: string) =>
            name.startsWith('sessions_') && name !== 'sessions_spawn' && name !== 'sessions_wait',
        ),
      ).toEqual([]);
      expect(systemPromptMessage.content).toContain(
        'Runtime: mobile (React Native / Expo), channel mobile-app.',
      );
      expect(getSkillSystemPrompts).toHaveBeenCalledWith('conv-super-agent-resume-weather');
    });
  });
});
