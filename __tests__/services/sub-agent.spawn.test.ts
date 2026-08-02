import {
  getSessionContext,
  getSubAgent,
  installSubAgentTestHarness,
  makeStructuredFinalizerResponse,
  mockProvider,
  sendMessageSpy,
  spawnSubAgent,
  startSubAgent,
  useChatStore,
} from '../helpers/subAgentHarness';
import { DEFAULT_SUB_AGENT_MAX_ITERATIONS } from '../../src/services/agents/lifecycle/runConfig';

describe('Sub-Agent Service', () => {
  installSubAgentTestHarness();

  describe('spawnSubAgent', () => {
    it('creates a sub-agent and returns result', async () => {
      const result = await spawnSubAgent(
        {
          parentConversationId: 'parent-1',
          prompt: 'Do something',
        },
        mockProvider,
      );
      expect(result).toBeDefined();
      expect(result.sessionId).toContain('sub-');
      expect(result.status).toBe('completed');
    });

    it('rejects worker launches when a remote provider has no API key configured', async () => {
      await expect(
        startSubAgent(
          {
            parentConversationId: 'p',
            prompt: 'credential check',
          },
          {
            ...mockProvider,
            name: 'Missing Key Provider',
            apiKey: '',
          },
        ),
      ).rejects.toThrow('Sub-agent provider "Missing Key Provider" has no API key configured.');
    });

    it('generates unique session IDs', async () => {
      const r1 = await spawnSubAgent({ parentConversationId: 'p', prompt: 'task1' }, mockProvider);
      const r2 = await spawnSubAgent({ parentConversationId: 'p', prompt: 'task2' }, mockProvider);
      expect(r1.sessionId).not.toBe(r2.sessionId);
    });

    it('returns output from orchestrator', async () => {
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'test' },
        mockProvider,
      );
      expect(result.output).toBeDefined();
    });

    it('does not expose internal workflow-evidence artifacts in the default worker prompt', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('worker output');
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: "Please output 'C64A' and complete.",
        },
        mockProvider,
      );

      expect(capturedOptions.systemPrompt).not.toContain('workflow_evidence');
      expect(capturedOptions.systemPrompt).not.toContain('structured workflow evidence');
    });

    it('rejects worker launches with an empty prompt before bootstrapping', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: '   ' as any },
        mockProvider,
      );

      expect(result.status).toBe('error');
      expect(result.error).toBe('Sub-agent prompt must be a non-empty string.');
      expect(runOrchestrator).not.toHaveBeenCalled();
    });

    it('appends the normalized prompt when seeded worker messages lack a usable user instruction', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'Inspect the repository state',
          initialMessages: [
            {
              id: 'broken-user',
              role: 'user',
              content: undefined as any,
              timestamp: Date.now(),
            },
          ] as any,
        },
        mockProvider,
      );

      expect(capturedOptions.messages).toEqual([
        expect.objectContaining({
          id: 'broken-user',
          role: 'user',
          content: '',
        }),
        expect.objectContaining({
          role: 'user',
          content: 'Inspect the repository state',
        }),
      ]);
    });

    it('keeps the worker session identity while targeting the parent conversation workspace for tools', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'parent-conversation', prompt: 'delegate work' },
        mockProvider,
      );

      expect(capturedOptions.conversationId).toBe(result.sessionId);
      expect(capturedOptions.workspaceConversationId).toBe('parent-conversation');
      expect(capturedOptions.workspaceReadFallbackConversationId).toBe(result.sessionId);
      expect(capturedOptions.usageConversationId).toBe('parent-conversation');
    });

    it('uses an explicit workspace read fallback when one is configured', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      await spawnSubAgent(
        {
          parentConversationId: 'side-thread-1',
          workspaceConversationId: 'parent-conversation',
          workspaceReadFallbackConversationId: 'side-thread-1',
          prompt: 'delegate work',
        },
        mockProvider,
      );

      expect(capturedOptions.workspaceConversationId).toBe('parent-conversation');
      expect(capturedOptions.workspaceReadFallbackConversationId).toBe('side-thread-1');
      expect(capturedOptions.usageConversationId).toBe('side-thread-1');
    });

    it.each([
      ['parentConversationId', { parentConversationId: ' parent-conversation' }],
      ['workspaceConversationId', { workspaceConversationId: ' parent-conversation' }],
      ['workspaceReadFallbackConversationId', { workspaceReadFallbackConversationId: '' }],
      ['agentRunId', { agentRunId: ' run-1' }],
      ['workstreamId', { workstreamId: 'workstream 1' }],
      ['parentSessionId', { parentSessionId: ' sub-parent' }],
    ])('rejects malformed %s before creating a worker', async (field, override) => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      const result = await spawnSubAgent(
        {
          parentConversationId: 'parent-conversation',
          prompt: 'delegate work',
          ...override,
        },
        mockProvider,
      );

      expect(result).toEqual(
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining(`${field} must be an exact durable identity`),
        }),
      );
      expect(runOrchestrator).not.toHaveBeenCalled();
    });

    it('records streamed worker usage on the parent conversation', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      const parentConversationId = useChatStore.getState().createConversation('test', 'system');

      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onUsage?.({
          model: 'gpt-5.4',
          inputTokens: 120,
          outputTokens: 45,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          totalTokens: 190,
        });
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      const result = await spawnSubAgent(
        { parentConversationId, prompt: 'delegate work' },
        mockProvider,
      );

      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === parentConversationId);
      expect(conversation?.usage).toEqual(
        expect.objectContaining({
          totalInput: 120,
          totalOutput: 45,
          totalCacheRead: 10,
          totalCacheWrite: 5,
          totalTokens: 190,
          totalCalls: 1,
        }),
      );
      expect(conversation?.usage?.entries[0]).toEqual(
        expect.objectContaining({
          source: 'sub-agent',
          sessionId: result.sessionId,
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 190,
        }),
      );
    });

    it('records hidden worker-finalizer usage on the parent conversation', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      const parentConversationId = useChatStore.getState().createConversation('test', 'system');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse('Finalized worker summary.', 'incomplete', {
          inputTokens: 60,
          outputTokens: 20,
          cacheReadTokens: 5,
          cacheWriteTokens: 0,
          totalTokens: 80,
        }) as any,
      );

      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onToolCallStart?.({
          id: 'tool-1',
          name: 'read_file',
          arguments: '{"path":"src/app.ts"}',
          status: 'running',
        });
        callbacks.onToolCallComplete?.({
          id: 'tool-1',
          name: 'read_file',
          arguments: '{"path":"src/app.ts"}',
          status: 'completed',
          result: 'Verified implementation details from src/app.ts and related files.',
        });
        callbacks.onToolMessage?.(
          'tool-1',
          'Verified implementation details from src/app.ts and related files.',
        );
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      await spawnSubAgent({ parentConversationId, prompt: 'delegate work' }, mockProvider);

      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === parentConversationId);
      const finalizerEntry = conversation?.usage?.entries.find(
        (entry) => entry.source === 'sub-agent-finalizer',
      );
      expect(finalizerEntry).toEqual(
        expect.objectContaining({
          inputTokens: 60,
          outputTokens: 20,
          cacheReadTokens: 5,
          totalTokens: 80,
        }),
      );
      expect(conversation?.usage).toEqual(
        expect.objectContaining({
          totalInput: 60,
          totalOutput: 20,
          totalCacheRead: 5,
          totalTokens: 80,
          totalCalls: 1,
        }),
      );
    });

    it('keeps terminal session context available during the post-completion grace window even past the LRU cap', async () => {
      const results = [];

      for (let index = 0; index < 21; index += 1) {
        results.push(
          await spawnSubAgent(
            { parentConversationId: 'parent', prompt: `task-${index}` },
            mockProvider,
          ),
        );
      }

      expect(getSessionContext(results[0].sessionId)).toBeDefined();
    });

    it('captures generated image artifacts on terminal worker results', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      const generatedImageResult = JSON.stringify({
        status: 'generated',
        providerId: 'openai',
        model: 'gpt-image-2',
        mimeType: 'image/png',
        fileUri: 'file:///mock/documents/workspace/parent-conversation/images/generated-worker.png',
        fileName: 'generated-worker.png',
        size: 2048,
        workspacePath: 'images/generated-worker.png',
      });

      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.(
          'Generating the requested image.',
          [
            {
              id: 'tool-image',
              name: 'image_generate',
              arguments: '{"prompt":"logo"}',
              status: 'running',
            },
          ],
          undefined,
          {
            kind: 'intermediate',
            completionStatus: 'complete',
            finishReason: 'tool_calls',
          },
        );
        callbacks.onToolCallStart?.({
          id: 'tool-image',
          name: 'image_generate',
          arguments: '{"prompt":"logo"}',
          status: 'running',
        });
        callbacks.onToolCallComplete?.({
          id: 'tool-image',
          name: 'image_generate',
          arguments: '{"prompt":"logo"}',
          status: 'completed',
          result: generatedImageResult,
        });
        callbacks.onToolMessage?.({
          version: 1,
          toolCallId: 'tool-image',
          status: 'completed',
          content: generatedImageResult,
        });
        callbacks.onAssistantMessage?.('The image has been generated.', [], undefined, {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        });
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'parent-conversation', prompt: 'generate a worker image' },
        mockProvider,
      );

      expect(result.artifacts).toEqual([
        expect.objectContaining({
          id: 'generated-image-tool-image',
          type: 'image',
          name: 'generated-worker.png',
          workspacePath: 'images/generated-worker.png',
        }),
      ]);
      expect(getSubAgent(result.sessionId)?.artifacts).toEqual([
        expect.objectContaining({
          id: 'generated-image-tool-image',
          workspacePath: 'images/generated-worker.png',
        }),
      ]);
    });

    it('handles orchestrator error', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onError?.(new Error('LLM failure'));
        return Promise.reject(new Error('LLM failure'));
      });
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'fail' },
        mockProvider,
      );
      expect(result.status).toBe('error');
      expect(result.error).toBe('LLM failure');
    });

    it('handles abort timeout', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, _callbacks: any) => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'timeout', timeoutMs: 100 },
        mockProvider,
      );
      expect(result.status).toBe('timeout');
    });

    it('does not assign a default deadline when timeoutMs is omitted', async () => {
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'no deadline' },
        mockProvider,
      );

      const agent = getSubAgent(result.sessionId);
      expect(agent?.deadlineAt).toBeUndefined();
    });

    it('uses custom model when specified', async () => {
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'custom', model: 'gpt-5-mini' },
        mockProvider,
      );
      expect(result.status).toBe('completed');
    });

    it('stores the originating agent run id on the active worker snapshot', async () => {
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'tracked', agentRunId: 'run-42' },
        mockProvider,
      );

      const agent = getSubAgent(result.sessionId);
      expect(agent?.agentRunId).toBe('run-42');
    });

    it('does not expose the execution-evidence contract for ad hoc workers tracked only by agentRunId', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'Inspect the workspace.', agentRunId: 'run-42' },
        mockProvider,
      );

      expect(capturedOptions.systemPrompt).not.toContain('## Execution Evidence Contract');
    });

    it('lets the graph own the adaptive default horizon while recording worker actions', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        for (let index = 0; index < DEFAULT_SUB_AGENT_MAX_ITERATIONS; index += 1) {
          callbacks.onToolCallStart?.({
            id: `tc-${index}`,
            name: 'read_file',
            arguments: '{}',
            status: 'running',
          });
          callbacks.onToolCallComplete?.({
            id: `tc-${index}`,
            name: 'read_file',
            arguments: '{}',
            status: 'completed',
            result: `result-${index}`,
          });
        }
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'default iteration budget' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.iterations).toBe(DEFAULT_SUB_AGENT_MAX_ITERATIONS);
      expect(capturedOptions).not.toHaveProperty('maxToolIterations');
    });

    it('with allProviders parameter', async () => {
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'multi' },
        mockProvider,
        [mockProvider],
      );
      expect(result.status).toBe('completed');
    });

    it('tracks tool usage', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onToolCallStart?.({ name: 'search' });
        callbacks.onToolCallComplete?.();
        callbacks.onToken?.('result');
        callbacks.onDone?.();
        return Promise.resolve({ terminalDisposition: 'final_candidate' });
      });
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'tools' },
        mockProvider,
      );
      expect(result.toolsUsed).toContain('search');
      expect(result.iterations).toBe(1);
    });

    it('treats maxIterations aborts as guardrail errors, not timeouts', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        for (let index = 0; index <= DEFAULT_SUB_AGENT_MAX_ITERATIONS; index += 1) {
          callbacks.onToolCallStart?.({
            id: `tc-${index}`,
            name: 'read_file',
            arguments: '{}',
            status: 'running',
          });
        }
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'guardrail', maxIterations: 1 },
        mockProvider,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('maxIterations');
      expect(result.iterations).toBe(DEFAULT_SUB_AGENT_MAX_ITERATIONS + 1);
    });
  });
});
