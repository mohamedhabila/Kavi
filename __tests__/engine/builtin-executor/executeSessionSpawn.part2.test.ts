// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSpawn part 2
// ---------------------------------------------------------------------------

import { executeSessionSpawn, mockChatStoreState } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSpawn part 2', () => {
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

    it('allows an ad hoc worker launch when a multi-workstream plan already exists', async () => {
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
                objective: 'Build the feature',
                successCriteria: ['Ship it'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: 'Architecture' },
                  { id: 'workstream-2', title: 'Implementation', dependencies: ['workstream-1'] },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        { prompt: 'Build the feature end-to-end', name: 'Lead Developer' },
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
      expect(parsed.workstreamId).toBeUndefined();
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Lead Developer',
        }),
        expect.anything(),
        undefined,
      );
      expect(launchSubAgent.mock.calls[0][0].workstreamId).toBeUndefined();
    });

    it('rejects non-array dependency arguments instead of preserving legacy string handling', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        seedGoalRunConversation([
          { id: 'workstream-1', title: 'Architecture' },
          {
            id: 'workstream-2',
            title: 'Implementation',
            dependencies: ['workstream-1'],
          },
        ]),
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Build the feature end-to-end',
          name: 'Lead Developer',
          dependsOnWorkstreams: 'none.' as unknown as string[],
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
      expect(parsed).toMatchObject({
        status: 'error',
        code: 'invalid_argument_shape',
        repair: {
          retryable: true,
          invalidFields: ['dependsOnWorkstreams'],
        },
      });
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('blocks dependent goals until prerequisite goals complete', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        seedGoalRunConversation([
          { id: 'workstream-1', title: 'Architecture', status: 'active' },
          {
            id: 'workstream-2',
            title: 'Implementation',
            dependencies: ['workstream-1'],
          },
        ]),
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Implement the approved design',
          workstreamId: 'workstream-2',
          dependsOnWorkstreams: ['workstream-1'],
          name: 'Developer',
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
      expect(parsed.status).toBe('blocked');
      expect(parsed.error).toContain('workstream-1');
      expect(parsed.dependsOnWorkstreams).toEqual(['workstream-1']);
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('blocks re-spawning a goal while another worker for that goal is still running', async () => {
      const {
        launchSubAgent,
        listActiveSubAgents,
      } = require('../../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        {
          sessionId: 'sub-review-1',
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
          workstreamId: 'workstream-2',
          depth: 0,
          startedAt: 10,
          updatedAt: 20,
          status: 'running',
          sandboxPolicy: 'inherit',
        },
      ]);
      mockChatStoreState.conversations = [
        seedGoalRunConversation([
          { id: 'workstream-1', title: 'Architecture', status: 'completed' },
          { id: 'workstream-2', title: 'Review', status: 'active' },
        ]),
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Review the implementation again.',
          workstreamId: 'workstream-2',
          name: 'Reviewer',
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
      expect(parsed.status).toBe('blocked');
      expect(parsed.error).toContain('already running');
      expect(parsed.sessionId).toBe('sub-review-1');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('passes the bound goal id through to launched workers once prerequisites are complete', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        seedGoalRunConversation([
          { id: 'workstream-1', title: 'Architecture', status: 'completed' },
          {
            id: 'workstream-2',
            title: 'Implementation',
            dependencies: ['workstream-1'],
          },
        ]),
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Implement the approved design',
          workstreamId: 'workstream-2',
          dependsOnWorkstreams: ['workstream-1'],
          name: 'Developer',
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
        }),
        expect.anything(),
        undefined,
      );
    });

    it('allows dependent goals when prerequisite goals are already completed in graph state', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        seedGoalRunConversation([
          { id: 'workstream-1', title: 'Architecture', status: 'completed' },
          {
            id: 'workstream-2',
            title: 'Implementation',
            dependencies: ['workstream-1'],
          },
        ]),
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Implement the approved design',
          workstreamId: 'workstream-2',
          dependsOnWorkstreams: ['workstream-1'],
          name: 'Developer',
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
        }),
        expect.anything(),
        undefined,
      );
    });
  });
});
