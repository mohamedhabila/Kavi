// ---------------------------------------------------------------------------
// Tests - Orchestrator: Tool call handling part 8
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  createInitialAgentControlGraphSnapshot,
  executeTool,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('Orchestrator', () => {
  describe('Tool call handling part 8', () => {
    it('restricts pending expo workflows to workflow monitoring tools until the run is terminal', async () => {
      (executeTool as jest.Mock)
        .mockResolvedValueOnce(
          JSON.stringify({
            projectId: 'proj-1',
            projectName: 'Kavi',
            mode: 'github-workflow',
            workflowRun: {
              id: 101,
              status: 'queued',
              conclusion: null,
            },
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            projectId: 'proj-1',
            projectName: 'Kavi',
            mode: 'github-workflow',
            workflowRun: {
              id: 101,
              status: 'completed',
              conclusion: 'success',
            },
          }),
        );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'expo_eas_build', arguments: '{"projectId":"proj-1"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'The build finished successfully.' },
          { type: 'done', content: 'The build finished successfully.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-expo-workflow',
        systemPrompt: 'You are helpful',
        toolFilter: (toolName) =>
          ['expo_eas_build', 'expo_eas_workflow_status', 'expo_eas_workflow_wait'].includes(
            toolName,
          ),
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Start a build and wait until it finishes.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(3);
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenNthCalledWith(
        1,
        'expo_eas_build',
        '{"projectId":"proj-1"}',
        'conv-expo-workflow',
        expect.any(Object),
      );
      expect(JSON.stringify(mockStreamMessage.mock.calls)).toContain('[SYSTEM ASYNC HOLD]');
      expect(
        callbacks.calls.onAssistantMessage.some(
          (message) => message.assistantMetadata?.finishReason === 'background_workers_running',
        ),
      ).toBe(false);
    });

    it('keeps explicitly grounded catalog and browser tools available after catalog browse', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          category: 'browser',
          tools: [
            { name: 'browser_navigate', description: 'Navigate browser pages.' },
            { name: 'browser_click', description: 'Click browser elements.' },
            { name: 'browser_snapshot', description: 'Inspect browser state.' },
          ],
        }),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'tool_catalog', arguments: '{"category":"browser"}' },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Using browser tools now' },
          { type: 'done', content: 'Using browser tools now' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        toolFilter: (toolName) =>
          ['tool_catalog', 'browser_navigate', 'browser_snapshot', 'browser_click'].includes(
            toolName,
          ),
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Inspect the available capabilities and continue with the discovered option.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const firstTurnTools = new Set(
        (mockStreamMessage.mock.calls[0][1].tools || []).map((tool: any) => tool.name),
      );
      const secondTurnTools = new Set(
        (mockStreamMessage.mock.calls[1][1].tools || []).map((tool: any) => tool.name),
      );

      expect(firstTurnTools.has('tool_catalog')).toBe(true);
      expect(firstTurnTools.has('browser_navigate')).toBe(true);
      expect(secondTurnTools.has('browser_navigate')).toBe(true);
      expect(secondTurnTools.has('browser_snapshot')).toBe(true);
      expect(secondTurnTools.has('browser_click')).toBe(true);
      expect(executeTool).toHaveBeenCalledWith(
        'tool_catalog',
        '{"category":"browser"}',
        'conv1',
        expect.any(Object),
      );
    });

    it('builds a Gemini-focused tool set and descriptive system prompt for investigation requests', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Investigating' },
          { type: 'done', content: 'Investigating' },
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
            content:
              'Investigate the repo issue, compare with official docs online, and propose a fix.',
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
                id: 'goal-investigate',
                title: 'Investigate the repo issue',
                status: 'active',
                dependencies: [],
                evidence: [],
                createdAt: 1,
                updatedAt: 1,
                requiredCapabilities: ['discover', 'read', 'verify'],
                requiredResourceKinds: ['conversation_workspace', 'unknown'],
              },
            ],
          }),
        },
        callbacks,
      );

      const streamOptions = mockStreamMessage.mock.calls[0][1];
      const selectedToolNames = new Set((streamOptions.tools || []).map((tool: any) => tool.name));
      expect(selectedToolNames.has('glob_search')).toBe(true);
      expect(selectedToolNames.has('text_search')).toBe(true);
      expect(selectedToolNames.has('web_search')).toBe(true);
      expect(selectedToolNames.has('web_fetch')).toBe(true);
      expect(selectedToolNames.has('python')).toBe(false);
      expect(selectedToolNames.has('tool_catalog')).toBe(false);
      expect(selectedToolNames.has('browser_navigate')).toBe(false);
      expect(selectedToolNames.has('read_memory')).toBe(false);

      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      expect(systemPromptMessage).toMatchObject({ role: 'system' });
      expect(systemPromptMessage.content).not.toContain('- read_file:');
      expect(systemPromptMessage.content).not.toContain('tool_catalog categories');
      expect(systemPromptMessage.content).toContain(
        'Runtime: mobile (React Native / Expo), channel mobile-app.',
      );
    });

    it('keeps old transcript tools out of vague follow-up turns without graph grounding', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Retrying' },
          { type: 'done', content: 'Retrying' },
        ]),
      );

      const callbacks = makeCallbacks();
      const now = Date.now();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-2.5-pro',
        }),
        model: 'gemini-2.5-pro',
        conversationId: 'conv-gemini-follow-up',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'u1',
            role: 'user',
            content:
              'Compare our implementation against the official documentation for this exact issue.',
            timestamp: now,
          },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: now + 1,
            toolCalls: [
              {
                id: 'tc1',
                name: 'web_fetch',
                arguments: '{"urls":["https://ai.google.dev/gemini-api/docs/function-calling"]}',
                status: 'completed',
              },
            ],
          },
          {
            id: 'u2',
            role: 'user',
            content: 'Try comparing the official docs again',
            timestamp: now + 2,
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const streamOptions = mockStreamMessage.mock.calls[0][1];
      const selectedToolNames = new Set((streamOptions.tools || []).map((tool: any) => tool.name));

      expect(selectedToolNames.has('web_fetch')).toBe(false);
      expect(selectedToolNames.has('web_search')).toBe(false);
    });

    it('keeps web_search and web_fetch available after a successful search returns candidate urls', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          provider: 'gemini',
          searches: [
            {
              query: 'OpenAI structured outputs developer guide',
              results: [
                {
                  title: 'Structured outputs',
                  url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
                },
              ],
            },
          ],
        }),
      );

      mockStreamMessage
        .mockImplementationOnce(() =>
          createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: {
                id: 'tc-search',
                name: 'web_search',
                arguments: '{"queries":["OpenAI structured outputs developer guide"]}',
              },
            },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: 'Done.' },
            { type: 'done', content: 'Done.' },
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
        conversationId: 'conv-web-search-then-fetch',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Compare the official docs and use tools.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const secondTurnTools = new Set(
        (mockStreamMessage.mock.calls[1]?.[1]?.tools || []).map((tool: any) => tool.name),
      );
      expect(secondTurnTools.has('web_search')).toBe(true);
      expect(secondTurnTools.has('web_fetch')).toBe(true);
    });
  });
});
