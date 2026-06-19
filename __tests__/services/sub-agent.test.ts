// ---------------------------------------------------------------------------
// Sub-Agent Service — tests
// ---------------------------------------------------------------------------

// Mock orchestrator to call onDone immediately
jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn().mockImplementation((_opts: any, callbacks: any) => {
    callbacks.onToken?.('mock output');
    callbacks.onDone?.();
    return Promise.resolve();
  }),
  MAX_TOOL_ITERATIONS: 25,
}));

// Mock id generator for deterministic results
let mockIdCounter = 0;
let mockWorkspaceTargets: any[] = [];
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => `mock-id-${++mockIdCounter}`),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      workspaceTargets: mockWorkspaceTargets,
    }),
  },
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue(null),
}));

import {
  __resetSubAgentStateForTests,
  cancelSubAgent,
  getSessionContext,
  launchSubAgent,
  spawnSubAgent,
  startSubAgent,
  listActiveSubAgents,
  getSubAgent,
  cleanupSubAgents,
} from '../../src/services/agents/subAgent';
import { LlmService } from '../../src/services/llm/LlmService';
import { useChatStore } from '../../src/store/useChatStore';
import type { LlmProviderConfig } from '../../src/types/provider';

const mockProvider: LlmProviderConfig = {
  id: 'test',
  name: 'Test',
  type: 'openai' as any,
  apiKey: 'key',
  baseUrl: 'http://test',
  model: 'gpt-5.4',
  models: ['gpt-5.4'],
  enabled: true,
};

function makeStream(...events: any[]) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function makeStructuredFinalizerResponse(
  report: string,
  completionState: 'verified_success' | 'blocked' | 'incomplete',
  usage?: Partial<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  }>,
) {
  return {
    output_parsed: {
      report,
      completionState,
    },
    ...(usage
      ? {
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheWriteTokens: usage.cacheWriteTokens ?? 0,
            totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          },
        }
      : {}),
  };
}

describe('Sub-Agent Service', () => {
  let streamMessageSpy: jest.SpyInstance;
  let sendMessageSpy: jest.SpyInstance;

  beforeEach(async () => {
    await __resetSubAgentStateForTests();
    mockIdCounter = 0;
    mockWorkspaceTargets = [];
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
    const { runOrchestrator } = require('../../src/engine/orchestrator');
    runOrchestrator.mockReset();
    runOrchestrator.mockImplementation((_opts: any, callbacks: any) => {
      callbacks.onToken?.('mock output');
      callbacks.onDone?.();
      return Promise.resolve();
    });
    streamMessageSpy = jest
      .spyOn(LlmService.prototype, 'streamMessage')
      .mockImplementation(() => makeStream({ type: 'done', content: '' }) as any);
    sendMessageSpy = jest.spyOn(LlmService.prototype, 'sendMessage').mockResolvedValue({});
    // Note: cleanupSubAgents only removes old non-running agents
    // We can't truly reset the map from outside, so tests should be independent
  });

  afterEach(() => {
    jest.useRealTimers();
    streamMessageSpy.mockRestore();
    sendMessageSpy.mockRestore();
  });

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
        return Promise.resolve();
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
        return Promise.resolve();
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
        return Promise.resolve();
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
        return Promise.resolve();
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
        return Promise.resolve();
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
        return Promise.resolve();
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
        callbacks.onAssistantMessage?.('Generating the requested image.');
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
        callbacks.onToolMessage?.('tool-image', generatedImageResult);
        callbacks.onAssistantMessage?.('The image has been generated.');
        callbacks.onDone?.();
        return Promise.resolve();
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

    it('passes inheritMemory config', async () => {
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'mem', inheritMemory: true },
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
        return Promise.resolve();
      });

      await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'Inspect the workspace.', agentRunId: 'run-42' },
        mockProvider,
      );

      expect(capturedOptions.systemPrompt).not.toContain('## Execution Evidence Contract');
    });

    it('uses the mobile-bounded default iteration cap for delegated workers', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        for (let index = 0; index < 25; index += 1) {
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
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'default iteration budget' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.iterations).toBe(25);
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
        return Promise.resolve();
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
        for (let index = 0; index < 25; index += 1) {
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
    });

    it('launchSubAgent returns before worker bootstrap begins', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const launched = await launchSubAgent(
        { parentConversationId: 'p', prompt: 'background task' },
        mockProvider,
      );

      expect(launched.status).toBe('running');
      expect(getSubAgent(launched.sessionId)?.launchState).toBe('queued');
      expect(runOrchestrator).not.toHaveBeenCalled();

      await jest.runOnlyPendingTimersAsync();

      expect(runOrchestrator).toHaveBeenCalledTimes(1);
    });

    it('startSubAgent keeps a waitable resultPromise while deferring worker bootstrap', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onToken?.('deferred output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const started = await startSubAgent(
        { parentConversationId: 'p', prompt: 'waitable task' },
        mockProvider,
      );

      expect(started.status).toBe('running');
      expect(runOrchestrator).not.toHaveBeenCalled();

      await jest.runOnlyPendingTimersAsync();

      await expect(started.resultPromise).resolves.toMatchObject({
        status: 'completed',
        output: 'deferred output',
      });
    });

    it('updates worker activity during bootstrap before the first token arrives', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      let releaseRun: (() => void) | undefined;
      runOrchestrator.mockImplementationOnce(
        (_opts: any, callbacks: any) =>
          new Promise<void>((resolve) => {
            callbacks.onStateChange?.('thinking');
            releaseRun = () => {
              callbacks.onDone?.();
              resolve();
            };
          }),
      );

      const started = await startSubAgent(
        { parentConversationId: 'p', prompt: 'plan before speaking' },
        mockProvider,
      );

      expect(getSubAgent(started.sessionId)?.currentActivity).toBe('Queued to start');
      expect(getSubAgent(started.sessionId)?.launchState).toBe('queued');

      await jest.runOnlyPendingTimersAsync();

      expect(getSubAgent(started.sessionId)?.currentActivity).toBe('Planning task');
      expect(getSubAgent(started.sessionId)?.launchState).toBe('active');

      releaseRun?.();
      await started.resultPromise;
    });

    it('replaces generic responding activity with streamed worker output once tokens arrive', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      let releaseRun: (() => void) | undefined;
      const streamedText = `${'Initial setup details. '.repeat(24)}Tail marker: streaming concrete worker output.`;
      runOrchestrator.mockImplementationOnce(
        (_opts: any, callbacks: any) =>
          new Promise<void>((resolve) => {
            callbacks.onStateChange?.('responding');
            callbacks.onToken?.(streamedText);
            releaseRun = () => {
              callbacks.onDone?.();
              resolve();
            };
          }),
      );

      const started = await startSubAgent(
        { parentConversationId: 'p', prompt: 'stream visible worker text' },
        mockProvider,
      );

      await jest.runOnlyPendingTimersAsync();

      expect(getSubAgent(started.sessionId)?.currentActivity).toContain(
        'Tail marker: streaming concrete worker out',
      );
      expect(getSubAgent(started.sessionId)?.currentActivity).not.toBe(
        'Preparing initial response',
      );

      releaseRun?.();
      await started.resultPromise;
    });

    it('fails a deferred worker that never bootstraps and preserves launch diagnostics', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      const originalSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
        handler: TimerHandler,
        timeout?: number,
        ...args: any[]
      ) => {
        if ((timeout ?? 0) === 0) {
          return 999999 as any;
        }
        return originalSetTimeout(handler as any, timeout as any, ...args) as any;
      }) as typeof setTimeout);

      try {
        const started = await startSubAgent(
          { parentConversationId: 'p', prompt: 'stalled launch' },
          mockProvider,
        );

        expect(getSubAgent(started.sessionId)?.launchState).toBe('queued');

        await jest.advanceTimersByTimeAsync(2_000);
        expect(getSubAgent(started.sessionId)?.currentActivity).toBe(
          'Still starting worker runtime',
        );
        expect(getSubAgent(started.sessionId)?.launchState).toBe('queued');

        await jest.advanceTimersByTimeAsync(18_000);

        await expect(started.resultPromise).resolves.toMatchObject({
          status: 'error',
          error: expect.stringContaining('stalled before bootstrapping'),
        });
        expect(getSubAgent(started.sessionId)?.launchState).toBe('terminal');
        expect(runOrchestrator).not.toHaveBeenCalled();
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    it('does not bootstrap a deferred worker after pre-start cancellation', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      jest.useFakeTimers();
      runOrchestrator.mockImplementationOnce(() => {
        throw new Error('worker should not start');
      });

      const launched = await launchSubAgent(
        { parentConversationId: 'p', prompt: 'cancel me early' },
        mockProvider,
      );

      const cancelled = cancelSubAgent(launched.sessionId, 'Stop before bootstrap');
      expect(cancelled?.status).toBe('cancelled');

      await jest.runOnlyPendingTimersAsync();

      expect(runOrchestrator).not.toHaveBeenCalled();
      expect(getSubAgent(launched.sessionId)?.status).toBe('cancelled');
    });
  });

  describe('listActiveSubAgents', () => {
    it('lists spawned sub-agents', async () => {
      await spawnSubAgent({ parentConversationId: 'p', prompt: 'task' }, mockProvider);
      const agents = listActiveSubAgents();
      expect(agents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getSubAgent', () => {
    it('returns sub-agent by ID', async () => {
      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'task' },
        mockProvider,
      );
      const agent = getSubAgent(result.sessionId);
      expect(agent).toBeDefined();
    });

    it('returns undefined for unknown ID', () => {
      expect(getSubAgent('unknown-id-that-does-not-exist')).toBeUndefined();
    });
  });

  describe('cleanupSubAgents', () => {
    it('does not throw', () => {
      expect(() => cleanupSubAgents()).not.toThrow();
    });
  });

  describe('spawnSubAgent — sandbox enforcement', () => {
    it('passes toolFilter for safe-only sandbox policy', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('sandbox output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'sandbox task',
          sandboxPolicy: 'safe-only',
        },
        mockProvider,
      );

      expect(capturedOptions).toBeDefined();
      expect(typeof capturedOptions.toolFilter).toBe('function');
    });

    it('does not pass toolFilter for full sandbox policy', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('full output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'full access',
          sandboxPolicy: 'full',
        },
        mockProvider,
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.toolFilter).toBeUndefined();
    });

    it('does not pass toolFilter for inherit sandbox policy', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('inherit output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'inherit',
          sandboxPolicy: 'inherit',
        },
        mockProvider,
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.toolFilter).toBeUndefined();
    });

    it('treats an explicit empty worker tools list as a no-tools whitelist', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('direct output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'return direct token',
          tools: [],
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(capturedOptions).toBeDefined();
      expect(typeof capturedOptions.toolFilter).toBe('function');
      expect(capturedOptions.toolFilter('read_workflow_evidence')).toBe(false);
      expect(capturedOptions.toolFilter('record_workflow_evidence')).toBe(false);
      expect(capturedOptions.toolFilter('python')).toBe(false);
    });

    it('requires scoped execution units for worker graph planning', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('worker output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'Read a file and summarize it.',
          tools: ['read_file'],
        },
        mockProvider,
      );

      expect(capturedOptions).toEqual(
        expect.objectContaining({
          toolFilter: expect.any(Function),
        }),
      );
      expect(capturedOptions.toolFilter('read_file')).toBe(true);
      expect(capturedOptions.toolFilter('write_file')).toBe(false);
    });

    it('stores a worker-owned task ledger from the worker graph state', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      const {
        createInitialAgentControlGraphSnapshot,
      } = require('../../src/engine/graph/agentControlGraph');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAgentControlGraphStateChange?.(
          createInitialAgentControlGraphSnapshot({
            goals: [
              {
                id: 'worker-read',
                title: 'Read scoped worker input',
                status: 'active',
                owner: 'worker',
                dependencies: [],
                evidence: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          }),
        );
        callbacks.onToken?.('worker output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'Read the delegated input.',
          tools: ['read_file'],
        },
        mockProvider,
      );

      const snapshot = getSubAgent(result.sessionId);
      expect(snapshot?.taskLedger).toEqual([
        expect.objectContaining({
          id: 'worker-read',
          status: 'active',
          owner: 'worker',
          title: 'Read scoped worker input',
        }),
      ]);
    });

    it('treats an explicit empty serialized worker tools list as a no-tools whitelist', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onToken?.('direct output');
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'return direct token',
          tools: '[]',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(capturedOptions).toBeDefined();
      expect(typeof capturedOptions.toolFilter).toBe('function');
      expect(capturedOptions.toolFilter('web_search')).toBe(false);
    });

    it('safe-only toolFilter blocks non-safe tools', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedFilter: ((name: string) => boolean) | undefined;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedFilter = opts.toolFilter;
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'safe only',
          sandboxPolicy: 'safe-only',
        },
        mockProvider,
      );

      // Safe tools should pass
      expect(capturedFilter!('web_search')).toBe(true);
      expect(capturedFilter!('web_fetch')).toBe(true);
      expect(capturedFilter!('glob_search')).toBe(true);
      expect(capturedFilter!('text_search')).toBe(true);
      expect(capturedFilter!('sessions_status')).toBe(true);
      expect(capturedFilter!('sessions_output')).toBe(true);
      expect(capturedFilter!('sessions_wait')).toBe(true);
      expect(capturedFilter!('expo_eas_status')).toBe(true);
      // Dangerous tools should be blocked
      expect(capturedFilter!('execute_command')).toBe(false);
      expect(capturedFilter!('write_file')).toBe(false);
    });

    it('treats configured worker tools as exact names before applying the sandbox filter', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      let capturedOptions: any = null;
      runOrchestrator.mockImplementationOnce((opts: any, callbacks: any) => {
        capturedOptions = opts;
        callbacks.onDone?.();
        return Promise.resolve();
      });

      await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'exact tools',
          tools: ['read_file', 'web_search'],
          sandboxPolicy: 'safe-only',
        },
        mockProvider,
      );

      expect(capturedOptions.toolFilter('read_file')).toBe(true);
      expect(capturedOptions.toolFilter('web_search')).toBe(true);
      expect(capturedOptions.toolFilter('ReadFile')).toBe(false);
      expect(capturedOptions.toolFilter('write_file')).toBe(false);
    });

    it('fails fast when explicit worker tools are incompatible with the safe-only sandbox', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'write a file',
          tools: ['write_file'],
          sandboxPolicy: 'safe-only',
        },
        mockProvider,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('not allowed by the safe-only sandbox');
      expect(runOrchestrator).not.toHaveBeenCalled();
    });

    it('fails fast when explicit worker tools are currently unavailable at runtime', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          prompt: 'fix the repo files',
          tools: ['workspace_launch_browser'],
        },
        mockProvider,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('currently available');
      expect(runOrchestrator).not.toHaveBeenCalled();
    });
  });

  describe('spawnSubAgent — output capture for tool-only responses', () => {
    it('synthesizes a final worker report when a tool phase ends without terminal text', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'Final report: files reviewed and changes are ready.',
          'incomplete',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        // First iteration: assistant produces text + tool call
        callbacks.onToken?.('Initial analysis: ');
        callbacks.onAssistantMessage?.('Initial analysis: reviewing files');
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        // Second iteration: only tool calls (no text tokens) — typical for Claude
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'write_file' });
        callbacks.onToolCallComplete?.();
        // onDone without final text
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'tool heavy task' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.output).toBe('Final report: files reviewed and changes are ready.');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to prior visible worker text if the finalization pass fails', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockRejectedValueOnce(new Error('finalizer failed'));
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Initial analysis: reviewing files');
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'write_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'tool heavy task' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.output).toBe('Initial analysis: reviewing files');
    });

    it('synthesizes output from tool-only iterations', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'Final report: repository scan completed and matching files were found.',
          'incomplete',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        // All iterations produce only tool calls — no text at all
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'text_search' });
        callbacks.onToolCallComplete?.();
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'silent tools' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.output).toBe(
        'Final report: repository scan completed and matching files were found.',
      );
    });

    it('synthesizes output with status info on timeout with tool-only responses', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        // Simulate tool calls then abort
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'web_search' });
        callbacks.onToolCallComplete?.();
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'complex query', timeoutMs: 50 },
        mockProvider,
      );

      expect(result.status).toBe('timeout');
      expect(result.output).toContain('Sub-agent timeout');
      expect(result.output).toContain('web_search');
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('prefers the terminal assistant answer over earlier planning text', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Plan: inspect files first.', [
          { id: 'tc1', name: 'read_file', arguments: '{}', status: 'pending' },
        ]);
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onToken?.('Final answer: all checks passed.');
        callbacks.onAssistantMessage?.('Final answer: all checks passed.', []);
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'complete the task' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.output).toBe('Final answer: all checks passed.');
    });

    it('marks terminal worker prose incomplete when execution-backed work omits completion_state', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Plan: update the artifact.', [
          { id: 'tc1', name: 'file_edit', arguments: '{}', status: 'pending' },
        ]);
        callbacks.onToolCallStart?.({ name: 'file_edit' });
        callbacks.onToolCallComplete?.({
          id: 'tc1',
          name: 'file_edit',
          result: 'Updated src/App.tsx and saved changes.',
          status: 'completed',
        });
        callbacks.onAssistantMessage?.('Final answer: artifact updated.', []);
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-terminal-evidence',
          workstreamId: 'edit',
          prompt: 'Update src/App.tsx and verify the artifact.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Final answer: artifact updated.');
      expect(result.output).not.toContain('completion_state:');
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('blocks success claims for execution tasks when no commit/push/deploy evidence exists', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse('تم النشر بنجاح.', 'verified_success') as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Investigating files only');
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-exec-no-evidence',
          workstreamId: 'deploy',
          prompt: 'Create app, commit, push, and deploy until green.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('blocked');
      expect(result.output).toBe('تم النشر بنجاح.');
    });

    it('preserves verified_success inspection output for ad hoc workers tracked only by agentRunId', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          '- package.json: missing\n- README.md: missing\n- workspace: empty',
          'verified_success',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Inspecting the workspace');
        callbacks.onToolCallStart?.({ name: 'list_files' });
        callbacks.onToolCallComplete?.({
          name: 'list_files',
          result: '(empty directory)',
        });
        callbacks.onToolCallStart?.({ name: 'glob_search', arguments: '{"pattern":"*"}' });
        callbacks.onToolCallComplete?.({
          name: 'glob_search',
          result: 'No files matched "*" under .',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-ad-hoc-inspection',
          prompt: 'Inspect the workspace for package.json and README.md.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('verified_success');
      expect(result.output).toContain('- package.json: missing');
      expect(result.output).not.toContain('completion_state:');
    });

    it('keeps execution-backed worker reports incomplete when finalization does not certify completion', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'Deployment succeeded on workflow run 101.',
          'incomplete',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Monitoring workflow');
        callbacks.onToolCallStart?.({ name: 'expo_eas_workflow_status' });
        callbacks.onToolCallComplete?.({
          name: 'expo_eas_workflow_status',
          result: 'workflow run 101 completed with success',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-expo-evidence',
          workstreamId: 'deploy',
          prompt: 'Create app, commit, push, and deploy until green.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Deployment succeeded on workflow run 101.');
    });

    it('keeps artifact-edit worker reports incomplete when finalization does not certify completion', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'Updated the requested app shell file.',
          'incomplete',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Applying the requested code change');
        callbacks.onToolCallStart?.({ name: 'file_edit' });
        callbacks.onToolCallComplete?.({
          name: 'file_edit',
          result: 'Updated src/App.tsx and saved changes.',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-artifact-evidence',
          workstreamId: 'edit',
          prompt: 'Update src/App.tsx and save the fix.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Updated the requested app shell file.');
    });

    it('uses the most conservative state when worker reports contain contradictory completion states', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.(
          'completion_state: verified_success\nactions_taken: ["tool:file_edit"]\n\ncompletion_state: incomplete\n\nThe file changed, but verification did not run.',
        );
        callbacks.onToolCallStart?.({ name: 'file_edit' });
        callbacks.onToolCallComplete?.({
          name: 'file_edit',
          result: 'Updated src/App.tsx and saved changes.',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-contradictory-completion-state',
          workstreamId: 'mixed',
          prompt: 'Update src/App.tsx and run verification.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).not.toContain('completion_state: verified_success');
      expect(result.output).not.toContain('completion_state: incomplete');
      expect(result.output).toContain('The file changed, but verification did not run.');
    });

    it('does not self-certify verified_success after a max-iterations abort just because tool evidence exists', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'The worker completed the task successfully.',
          'verified_success',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onToolCallStart?.({
          id: 'tc-1',
          name: 'write_file',
          arguments: '{"path":"graphbatchcheck.txt","content":"batch flow ok"}',
          status: 'running',
        });
        callbacks.onToolCallComplete?.({
          id: 'tc-1',
          name: 'write_file',
          status: 'completed',
          result: 'Wrote 13 chars to graphbatchcheck.txt',
        });
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-max-iterations-guardrail',
          workstreamId: 'graphbatchcheck',
          prompt: 'Create graphbatchcheck.txt with batch flow ok and verify it.',
          maxIterations: 1,
        },
        mockProvider,
      );

      expect(result.status).not.toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('The worker completed the task successfully.');
      expect(result.output).not.toContain('completion_state:');
    });

    it('keeps dynamic skill worker reports incomplete when finalization does not certify completion', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse('Release finished successfully.', 'incomplete') as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Running the release workflow');
        callbacks.onToolCallStart?.({ name: 'skill__acme_ops__release_delivery' });
        callbacks.onToolCallComplete?.({
          name: 'skill__acme_ops__release_delivery',
          result: 'Release deployment completed successfully.',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-dynamic-release',
          workstreamId: 'release',
          prompt: 'Run the release workflow and verify the deployment completed.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Release finished successfully.');
    });

    it('keeps worker-reported blocked completion state separate from the visible report', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse('Resultat final en attente.', 'blocked') as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Monitoring workflow');
        callbacks.onToolCallStart?.({ name: 'expo_eas_workflow_status' });
        callbacks.onToolCallComplete?.({
          name: 'expo_eas_workflow_status',
          result: 'workflow run 101 failed with environment constraints',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-expo-contradiction',
          workstreamId: 'deploy',
          prompt: 'Create app, commit, push, and deploy until green.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('blocked');
      expect(result.output).toBe('Resultat final en attente.');
    });
  });
});
