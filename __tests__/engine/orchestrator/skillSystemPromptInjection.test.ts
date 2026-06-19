// ---------------------------------------------------------------------------
// Tests - Orchestrator: Skill system prompt injection
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  getSkillSystemPrompts,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Skill system prompt injection', () => {
    it('keeps the default runtime system prompt product-neutral', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-generic-runtime-prompt',
        systemPrompt: '',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Create a file and commit it',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].role).toBe('system');
      expect(apiMessages[0].content).toContain('mobile workspace');
      expect(apiMessages[0].content).not.toContain('Kavi');
    });

    it('keeps the SuperAgent runtime system prompt product-neutral', async () => {
      const registryModule = jest.requireMock('../../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-superagent-runtime-prompt',
        systemPrompt: '',
        personaId: 'super-agent',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Create a file and commit it',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].role).toBe('system');
      expect(apiMessages[0].content).not.toContain('Kavi');
    });

    it('keeps the SuperAgent runtime prompt compact while preserving graph-critical contracts', async () => {
      const registryModule = jest.requireMock('../../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

      const callbacks = makeCallbacks();
      await runOrchestrator(
        {
          provider: makeProvider(),
          model: 'gpt-5.4',
          conversationId: 'conv-superagent-lean-prompt',
          systemPrompt: 'You are helpful',
          personaId: 'super-agent',
          messages: [
            {
              id: 'msg1',
              role: 'user',
              content: 'Create a file and verify the result',
              timestamp: Date.now(),
            },
          ],
        },
        callbacks,
      );

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      const systemContent = apiMessages[0].content;
      expect(systemContent.length).toBeLessThan(12000);
      expect(systemContent).not.toContain('## Tool Call Style');
      expect(systemContent).not.toContain('## Agent Mode');
      expect(systemContent).not.toContain(['Phase', '1'].join(' '));
      expect(systemContent).not.toContain('CRITICAL: Apply this protocol');
    });

    it('should include skill prompts in the system prompt sent to LLM', async () => {
      (getSkillSystemPrompts as jest.Mock).mockResolvedValueOnce(
        'Available skills:\n- Weather: skills/managed/weather/SKILL.md',
      );

      mockStreamMessage.mockImplementationOnce(() => {
        // Capture the system prompt passed to the LLM
        return createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]);
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Weather?', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      // Verify LLM was called with system prompt containing skill content
      expect(mockStreamMessage).toHaveBeenCalled();
      const callArgs = mockStreamMessage.mock.calls[0];
      // Could be passed positionally or as an options object
      const allArgs = JSON.stringify(callArgs);
      expect(allArgs).toContain('Available skills:');
      expect(allArgs).toContain('Weather');
      expect(callbacks.onDone).toHaveBeenCalled();
    });
  });
});
