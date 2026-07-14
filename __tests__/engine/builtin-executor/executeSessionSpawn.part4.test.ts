// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSpawn part 4
// ---------------------------------------------------------------------------

import {
  executeSessionSpawn,
  mockBuildLeastPrivilegeWorkerMemoryBundle,
  mockChatStoreState,
} from '../../helpers/builtinExecutorHarness';
import { parseFailedToolOutcome } from '../../helpers/toolRuntimeOutcome';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSpawn part 4', () => {
    it('selects and seals a task-scoped memory bundle for the worker', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      const memoryBundle = {
        version: 1,
        source: {
          memoryOwnerId: 'owner-1',
          memoryConversationId: 'parent-conv-1',
          sourceThreadId: 'parent-conv-1',
          personaId: 'persona-1',
          taskId: null,
        },
        createdAt: 1,
        facts: [],
        episodes: [
          {
            episodeId: 'episode-1',
            lane: 'current_thread',
            summary: 'Relevant verified outcome',
            sourceEndMessageId: 'message-1',
            endedAt: 1,
          },
        ],
      };
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          personaId: 'persona-1',
          messages: [],
        },
      ];
      mockBuildLeastPrivilegeWorkerMemoryBundle.mockResolvedValueOnce(memoryBundle);

      await executeSessionSpawn({ prompt: 'Use the prior verified outcome' }, 'parent-conv-1', {
        id: 'test',
        name: 'Test',
        type: 'openai',
        apiKey: 'k',
        baseUrl: 'u',
        model: 'gpt-5.4',
        models: ['gpt-5.4'],
        enabled: true,
      });

      expect(mockBuildLeastPrivilegeWorkerMemoryBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          query: 'Use the prior verified outcome',
          memoryConversationId: 'parent-conv-1',
          sourceThreadId: 'parent-conv-1',
          personaId: 'persona-1',
          taskId: null,
        }),
      );
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          memorySelectionScope: {
            memoryConversationId: 'parent-conv-1',
            sourceThreadId: 'parent-conv-1',
            personaId: 'persona-1',
            taskId: null,
          },
          memoryBundle,
        }),
        expect.anything(),
        undefined,
      );
    });

    it('ignores maxIterations hints so delegated workers keep the roomy default budget', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something', maxIterations: 4 } as any,
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
        expect.not.objectContaining({ maxIterations: expect.anything() }),
        expect.anything(),
        undefined,
      );
    });

    it('inherits the latest attached user turn into the worker seed without forwarding inline payload bytes', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Please inspect this screenshot',
              timestamp: 1,
              attachments: [
                {
                  id: 'att-1',
                  type: 'image',
                  uri: 'file:///tmp/screenshot.png',
                  name: 'screenshot.png',
                  mimeType: 'image/png',
                  size: 2048,
                  base64: 'should-not-be-forwarded',
                },
              ],
            },
          ],
        },
      ];

      await executeSessionSpawn(
        { prompt: 'Analyze the attached screenshot' },
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
          initialMessages: [
            expect.objectContaining({
              role: 'user',
              content: 'Analyze the attached screenshot',
              attachments: [
                expect.objectContaining({
                  id: 'att-1',
                  uri: 'file:///tmp/screenshot.png',
                }),
              ],
            }),
          ],
          linkUnderstandingEnabled: true,
          mediaUnderstandingEnabled: true,
        }),
        expect.anything(),
        undefined,
      );

      const forwardedAttachment = launchSubAgent.mock.calls[0][0].initialMessages[0].attachments[0];
      expect(forwardedAttachment.base64).toBeUndefined();
    });

    it('preserves parent session ancestry and resolves the owning conversation for nested workers', async () => {
      const {
        getSubAgent,
        listActiveSubAgents,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');

      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-child',
        parentConversationId: 'sub-root',
        agentRunId: 'run-42',
      });
      listActiveSubAgents.mockReturnValueOnce([
        { sessionId: 'sub-child', parentConversationId: 'sub-root' },
        { sessionId: 'sub-root', parentConversationId: 'parent-conv-1' },
      ]);

      await executeSessionSpawn(
        { prompt: 'Research the nested task' },
        'sub-child',
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
          parentSessionId: 'sub-child',
          workspaceConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('keeps a side thread as the parent conversation while targeting the parent workspace', async () => {
      const { launchSubAgent } = require('../../../src/services/agents/subAgent');

      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          title: 'Parent',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
          providerId: 'test',
          usage: {
            entries: [],
            totalInput: 0,
            totalOutput: 0,
            totalTokens: 0,
            totalCost: 0,
            totalCalls: 0,
          },
          logs: [],
          agentRuns: [],
        },
        {
          id: 'side-conv-1',
          title: 'Side',
          messages: [],
          createdAt: 2,
          updatedAt: 2,
          providerId: 'test',
          parentConversationId: 'parent-conv-1',
          isSideThread: true,
          activeAgentRunId: 'run-side',
          usage: {
            entries: [],
            totalInput: 0,
            totalOutput: 0,
            totalTokens: 0,
            totalCost: 0,
            totalCalls: 0,
          },
          logs: [],
          agentRuns: [],
        },
      ];

      await executeSessionSpawn(
        { prompt: 'Inspect the repository from the side thread' },
        'side-conv-1',
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
        undefined,
        { memoryConversationId: 'parent-conv-1' },
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'side-conv-1',
          workspaceConversationId: 'parent-conv-1',
          workspaceReadFallbackConversationId: 'side-conv-1',
          agentRunId: 'run-side',
          memorySelectionScope: {
            memoryConversationId: 'parent-conv-1',
            sourceThreadId: 'side-conv-1',
            personaId: 'default',
            taskId: null,
          },
        }),
        expect.anything(),
        undefined,
      );
    });

    it('returns a closed error for a malformed persisted workspace identity', async () => {
      const {
        getSessionContext,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'parent-conv-1',
          workspaceConversationId: ' parent-conv-1',
        },
      });

      const parsed = parseFailedToolOutcome(
        await executeSessionSpawn(
          { prompt: 'Research the task' },
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

      expect(parsed).toEqual(
        expect.objectContaining({
          status: 'error',
          code: 'session_spawn_error',
          error: 'conversation_workspace_configured_id_invalid',
        }),
      );
      expect(launchSubAgent).not.toHaveBeenCalled();
    });
  });
});
