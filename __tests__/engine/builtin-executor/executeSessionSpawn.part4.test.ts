// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSpawn part 4
// ---------------------------------------------------------------------------

import { executeSessionSpawn, mockChatStoreState } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSpawn part 4', () => {
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
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'side-conv-1',
          workspaceConversationId: 'parent-conv-1',
          workspaceReadFallbackConversationId: 'side-conv-1',
          agentRunId: 'run-side',
        }),
        expect.anything(),
        undefined,
      );
    });
  });
});
