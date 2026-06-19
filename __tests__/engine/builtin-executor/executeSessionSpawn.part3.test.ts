// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSpawn part 3
// ---------------------------------------------------------------------------

import { executeSessionSpawn, mockChatStoreState } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSpawn part 3', () => {
    function seedGoalRunConversation(
      goals: Array<{
        id: string;
        title: string;
        status?: 'pending' | 'active' | 'completed' | 'blocked';
        dependencies?: string[];
      }>,
    ) {
      const now = 1;
      return {
        id: 'parent-conv-1',
        activeAgentRunId: 'run-42',
        agentRuns: [
          {
            id: 'run-42',
            status: 'running',
            controlGraph: {
              version: 1,
              status: 'ready',
              iteration: 1,
              goals: goals.map((goal) => ({
                id: goal.id,
                title: goal.title,
                status: goal.status ?? 'pending',
                dependencies: goal.dependencies ?? [],
                evidence: [],
                createdAt: now,
                updatedAt: now,
              })),
              expectedToolCalls: [],
              observedToolResults: [],
              pendingAsyncCount: 0,
              lastModelToolNames: [],
              turnDirectives: {
                forceFinalText: false,
                requireDelegationTool: false,
                requireWorkflowTool: false,
                incompleteFinalTextRecoveryCount: 0,
              },
              audit: [],
              updatedAt: now,
              asyncWork: {
                awaitingBackgroundWorkers: false,
                pendingOperations: [],
                updatedAt: now,
              },
            },
          },
        ],
        messages: [],
      };
    }

    it('accepts dependency arrays without throwing a configuration error', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        seedGoalRunConversation([
          { id: 'workstream-1', title: 'Architecture', status: 'completed' },
          {
            id: 'workstream-2',
            title: 'Architecture Review',
            dependencies: ['workstream-1'],
          },
        ]),
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Review ARCHITECTURE.md and keep the response brief.',
          workstreamId: 'workstream-2',
          dependsOnWorkstreams: ['workstream-1'],
          name: 'Architecture Reviewer',
        },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.workstreamId).toBe('workstream-2');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          workstreamId: 'workstream-2',
          name: 'Architecture Reviewer',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('allows descriptive worker names without forcing a workstream binding', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Compare providers',
                successCriteria: ['Finish the research'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: '**Anthropic Research**' },
                  { id: 'workstream-2', title: '**OpenAI Research**' },
                  { id: 'workstream-3', title: '**Google Gemini Research**' },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        {
          prompt:
            'Research Anthropic official docs, tool-use behavior, and orchestration guidance.',
          name: 'Anthropic Research Agent',
        },
        'parent-conv-1',
        {
          id: 'anthropic',
          name: 'Anthropic',
          type: 'anthropic',
          apiKey: 'k',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
          availableModels: ['claude-sonnet-4-6'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.workstreamId).toBeUndefined();
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Anthropic Research Agent',
        }),
        expect.anything(),
        undefined,
      );
      expect(launchSubAgent.mock.calls[0][0].workstreamId).toBeUndefined();
    });

    it('handles spawn error', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      launchSubAgent.mockRejectedValueOnce(new Error('spawn failed'));
      const result = await executeSessionSpawn({ prompt: 'fail' }, 'conv-1', {
        id: 'test',
        name: 'Test',
        type: 'openai',
        apiKey: 'k',
        baseUrl: 'u',
        model: 'gpt-5.4',
        models: ['gpt-5.4'],
        enabled: true,
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('spawn failed');
    });

    it('can wait for completion when requested', async () => {
      const { waitForSubAgentResultPromise } = require('../../../src/services/agents/subAgent');
      const result = await executeSessionSpawn(
        { prompt: 'Research something', waitForCompletion: true },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('completed');
      expect(waitForSubAgentResultPromise).toHaveBeenCalledWith(expect.any(Promise), 180000);
    });

    it('uses the shared blocking wait window before returning a timed-out running worker', async () => {
      const {
        startSubAgent,
        waitForSubAgentResultPromise,
      } = require('../../../src/services/agents/subAgent');
      waitForSubAgentResultPromise.mockResolvedValueOnce(null);
      startSubAgent.mockResolvedValueOnce({
        sessionId: 'spawn-running-1',
        status: 'running',
        depth: 1,
        resultPromise: Promise.resolve({
          sessionId: 'spawn-running-1',
          output: 'later',
          toolsUsed: [],
          iterations: 1,
          status: 'completed',
          depth: 1,
        }),
      });

      const parsed = JSON.parse(
        await executeSessionSpawn(
          { prompt: 'Research something', waitForCompletion: true },
          'parent-conv-1',
          {
            id: 'test',
            name: 'Test',
            type: 'openai',
            apiKey: 'k',
            baseUrl: 'u',
            model: 'gpt-5.4',
            models: ['gpt-5.4'],
            enabled: true,
          },
          undefined,
        ),
      );

      expect(waitForSubAgentResultPromise).toHaveBeenCalledWith(expect.any(Promise), 180000);
      expect(parsed.status).toBe('running');
      expect(parsed.waitTimedOut).toBe(true);
      expect(parsed.waitTimeoutMs).toBe(180000);
      expect(parsed.usedDefaultWaitTimeout).toBe(true);
    });

    it('prefers the inherited parent model over the provider default', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something' },
        'parent-conv-1',
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          availableModels: ['gpt-5.4', 'gpt-5.4-mini'],
          enabled: true,
        },
        undefined,
        'gpt-5.4-mini',
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          model: 'gpt-5.4-mini',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('falls back to the worker provider model when the inherited parent model targets a different provider family', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something' },
        'parent-conv-1',
        {
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'k',
          model: 'claude-sonnet-4-6',
          availableModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
          enabled: true,
        },
        undefined,
        'openai/gpt-5.4',
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          model: 'claude-sonnet-4-6',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('passes the active agent run id through to launched workers', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
        },
      ];

      await executeSessionSpawn(
        { prompt: 'Research something' },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('ignores timeoutMs hints so delegated workers stay untimed', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something', timeoutMs: 5000 } as any,
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.not.objectContaining({ timeoutMs: expect.anything() }),
        expect.anything(),
        undefined,
      );
    });
  });
});
