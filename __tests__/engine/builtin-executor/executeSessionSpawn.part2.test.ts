// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSpawn part 2
// ---------------------------------------------------------------------------

import { executeSessionSpawn, mockChatStoreState } from '../../helpers/builtinExecutorHarness';
import {
  parseCompletedToolOutcome,
  parseFailedToolOutcome,
} from '../../helpers/toolRuntimeOutcome';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSpawn part 2', () => {
    function seedRunConversation() {
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

    function workstreamWorker(
      workstreamId: string,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        sessionId: `sub-${workstreamId}`,
        parentConversationId: 'parent-conv-1',
        agentRunId: 'run-42',
        workstreamId,
        depth: 0,
        startedAt: 10,
        updatedAt: 20,
        status: 'completed',
        completionState: 'verified_success',
        sandboxPolicy: 'inherit',
        ...overrides,
      };
    }

    it('assigns a workstream to an ad hoc worker launch', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
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

      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.status).toBe('running');
      expect(parsed.workstreamId).toBe('delegated-workstream');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Lead Developer',
        }),
        expect.anything(),
        undefined,
      );
      expect(launchSubAgent.mock.calls[0][0].workstreamId).toBe('delegated-workstream');
    });

    it('runs a worker under the workstream id the model named', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      const result = await executeSessionSpawn(
        {
          prompt: 'Return exactly: DELEGATION PASS',
          workstreamId: 'model-supplied-coordination-id',
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

      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.workstreamId).toBe('model-supplied-coordination-id');
      expect(launchSubAgent.mock.calls[0][0].workstreamId).toBe('model-supplied-coordination-id');
    });

    it('rejects non-array dependency arguments instead of preserving legacy string handling', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [seedRunConversation()];

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

      const parsed = parseFailedToolOutcome(result);
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

    it('blocks dependent work until its prerequisite worker delivers', async () => {
      const {
        launchSubAgent,
        listActiveSubAgents,
      } = require('../../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        workstreamWorker('workstream-1', { status: 'running', completionState: undefined }),
      ]);
      mockChatStoreState.conversations = [seedRunConversation()];

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

      const parsed = parseFailedToolOutcome(result);
      expect(parsed.status).toBe('blocked');
      expect(parsed.error).toContain('workstream-1');
      expect(parsed.dependsOnWorkstreams).toEqual(['workstream-1']);
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('blocks re-spawning a workstream while its worker is still running', async () => {
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
      mockChatStoreState.conversations = [seedRunConversation()];

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

      const parsed = parseFailedToolOutcome(result);
      expect(parsed.status).toBe('blocked');
      expect(parsed.error).toContain('already running');
      expect(parsed.sessionId).toBe('sub-review-1');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('runs dependent work under its named workstream once the prerequisite delivered', async () => {
      const {
        launchSubAgent,
        listActiveSubAgents,
      } = require('../../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([workstreamWorker('workstream-1')]);
      mockChatStoreState.conversations = [seedRunConversation()];

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

      const parsed = parseCompletedToolOutcome(result);
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
