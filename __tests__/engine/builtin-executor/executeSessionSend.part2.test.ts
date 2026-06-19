// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeSessionSend part 2
// ---------------------------------------------------------------------------

import {
  executeSessionSend,
  MOCK_PROVIDER,
  mockHydrateProviderForRequest,
} from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeSessionSend part 2', () => {
    it('can wait for follow-up completion when requested', async () => {
      const {
        getSubAgent,
        startSubAgent,
        waitForSubAgentResultPromise,
      } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      startSubAgent.mockResolvedValueOnce({
        sessionId: 'new-222',
        status: 'running',
        depth: 2,
        resultPromise: Promise.resolve({
          sessionId: 'new-222',
          output: 'Follow-up answer',
          toolsUsed: ['read_file'],
          iterations: 2,
          status: 'completed',
          depth: 2,
        }),
      });

      const result = await executeSessionSend(
        { sessionId: 'old-222', message: 'Tell me more', waitForCompletion: true },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('completed');
      expect(parsed.sessionId).toBe('new-222');
      expect(parsed.previousSessionId).toBe('old-222');
      expect(parsed.output).toBe('Follow-up answer');
      expect(waitForSubAgentResultPromise).toHaveBeenCalledWith(expect.any(Promise), 180000);
      expect(startSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          parentSessionId: 'old-222',
          prompt: 'Previous conversation output:\nDone\n\nFollow-up message: Tell me more',
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('uses the shared blocking wait window before returning a timed-out running follow-up worker', async () => {
      const {
        getSubAgent,
        startSubAgent,
        waitForSubAgentResultPromise,
      } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      waitForSubAgentResultPromise.mockResolvedValueOnce(null);
      startSubAgent.mockResolvedValueOnce({
        sessionId: 'new-333',
        status: 'running',
        depth: 2,
        resultPromise: Promise.resolve({
          sessionId: 'new-333',
          output: 'later',
          toolsUsed: [],
          iterations: 1,
          status: 'completed',
          depth: 2,
        }),
      });

      const parsed = JSON.parse(
        await executeSessionSend(
          { sessionId: 'old-333', message: 'Tell me more', waitForCompletion: true },
          MOCK_PROVIDER,
        ),
      );

      expect(waitForSubAgentResultPromise).toHaveBeenCalledWith(expect.any(Promise), 180000);
      expect(parsed.status).toBe('running');
      expect(parsed.waitTimedOut).toBe(true);
      expect(parsed.waitTimeoutMs).toBe(180000);
      expect(parsed.usedDefaultWaitTimeout).toBe(true);
    });

    it('passes provider to launchSubAgent on re-spawn', async () => {
      const { getSubAgent, launchSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-456',
        status: 'running',
        depth: 2,
      });
      await executeSessionSend({ sessionId: 'old-789', message: 'more' }, MOCK_PROVIDER);
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({ parentConversationId: 'conv-1' }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('falls back to a summary prompt when stored transcript context is unavailable', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'timeout',
        output: 'Previous timeout summary',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce(undefined);
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-321',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-timeout', message: 'retry with stricter scope' },
        MOCK_PROVIDER,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(
            'Previous conversation output:\nPrevious timeout summary',
          ),
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('does not inherit a previous worker timeout into follow-up workers', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Original task',
          timeoutMs: 5000,
          maxIterations: 12,
        },
        provider: MOCK_PROVIDER,
        conversationSummary: 'Done',
        messages: [{ id: 'u1', role: 'user', content: 'Original task', timestamp: 1 }],
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-timeout-free',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-timeout', message: 'Continue without a deadline' },
        MOCK_PROVIDER,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(expect.any(Object), MOCK_PROVIDER, undefined);
      expect(launchSubAgent.mock.calls[0][0].timeoutMs).toBeUndefined();
      expect(launchSubAgent.mock.calls[0][0].maxIterations).toBeUndefined();
    });

    it('does not inherit a previous worker maxIterations cap into follow-up workers', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Original task',
          maxIterations: 12,
        },
        provider: MOCK_PROVIDER,
        conversationSummary: 'Done',
        messages: [{ id: 'u1', role: 'user', content: 'Original task', timestamp: 1 }],
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-no-cap',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-max-iterations', message: 'Continue with the default budget' },
        MOCK_PROVIDER,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.not.objectContaining({ maxIterations: expect.anything() }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('re-spawns with the inherited parent model over the provider default', async () => {
      const { getSubAgent, launchSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-999',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-999', message: 'more' },
        MOCK_PROVIDER,
        'gpt-5.4-mini',
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          model: 'gpt-5.4-mini',
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('preserves the stored worker provider and model when the supervisor model targets a different family', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');
      const storedProvider = {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: '',
        model: 'claude-opus-4-6',
        availableModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
        enabled: true,
      };
      const hydratedProvider = {
        ...storedProvider,
        apiKey: 'sk-anthropic',
      };

      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Original task',
          model: 'claude-sonnet-4-6',
        },
        provider: storedProvider,
        allProviders: [storedProvider],
        conversationSummary: 'Done',
        messages: [{ id: 'u1', role: 'user', content: 'Original task', timestamp: 1 }],
      });
      mockHydrateProviderForRequest.mockResolvedValueOnce(hydratedProvider);
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-anthropic',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-anthropic', message: 'continue' },
        MOCK_PROVIDER,
        'gpt-5.4-mini',
      );

      expect(mockHydrateProviderForRequest).toHaveBeenCalledWith(storedProvider);
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          model: 'claude-sonnet-4-6',
        }),
        hydratedProvider,
        [hydratedProvider],
      );
    });

    it('returns an error when the stored worker provider no longer has an API key', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../../src/services/agents/subAgent');
      const storedProvider = {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        enabled: true,
      };

      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Original task',
          model: 'claude-sonnet-4-6',
        },
        provider: storedProvider,
        conversationSummary: 'Done',
        messages: [{ id: 'u1', role: 'user', content: 'Original task', timestamp: 1 }],
      });
      mockHydrateProviderForRequest.mockResolvedValueOnce(storedProvider);

      const result = await executeSessionSend(
        { sessionId: 'old-missing-key', message: 'continue' },
        MOCK_PROVIDER,
        'gpt-5.4-mini',
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('Worker provider "Anthropic" has no API key configured.');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('handles re-spawn failure', async () => {
      const { getSubAgent, launchSubAgent } = require('../../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      launchSubAgent.mockRejectedValueOnce(new Error('spawn failed'));
      const result = await executeSessionSend(
        { sessionId: 'old-456', message: 'more' },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('spawn failed');
    });
  });
});
