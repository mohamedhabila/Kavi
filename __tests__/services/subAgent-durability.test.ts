// ---------------------------------------------------------------------------
// Tests — Sub-Agent Durability
// ---------------------------------------------------------------------------

let mockAsyncStorageData: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStorageData[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStorageData[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockAsyncStorageData[key];
  }),
}));

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn().mockResolvedValue(undefined),
}));

const mockFinalizationStreamMessage = jest.fn();
jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    streamMessage: (...args: any[]) => mockFinalizationStreamMessage(...args),
  })),
}));

let mockIdCounter = 0;
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => `mock-id-${++mockIdCounter}`),
}));

import {
  __resetSubAgentStateForTests,
  MAX_SPAWN_DEPTH,
  isToolAllowedBySandbox,
  startSubAgent,
  launchSubAgent,
  spawnSubAgent,
  getSessionContext,
  listActiveSubAgents,
  getSubAgent,
  getSubAgentsByParent,
  detectOrphans,
  initSubAgentRegistry,
  cleanupSubAgents,
  onSubAgentEvent,
  type ActiveSubAgent,
} from '../../src/services/agents/subAgent';
import { runOrchestrator } from '../../src/engine/orchestrator';
import { File } from 'expo-file-system';
import * as throttledStorageModule from '../../src/store/throttledStorage';
import { _getStorageFileUris, flushPendingStorageWrites } from '../../src/store/throttledStorage';

const expoFileSystemMock = jest.requireMock('expo-file-system') as {
  __resetStore: () => void;
  __getStore: () => Record<string, string | Uint8Array>;
};

const REGISTRY_KEY = 'kavi-sub-agents';
const REGISTRY_CONTEXTS_KEY = 'kavi-sub-agent-contexts';

function createAsyncEventStream(events: any[] = []) {
  return (async function* stream() {
    for (const event of events) {
      yield event;
    }
  })();
}

function writePersistedJson(key: string, value: unknown): void {
  const { primary } = _getStorageFileUris(key);
  new File(primary).write(JSON.stringify(value));
}

function readPersistedJson<T>(key: string): T | undefined {
  const { primary } = _getStorageFileUris(key);
  const value = expoFileSystemMock.__getStore()[primary];
  return typeof value === 'string' ? (JSON.parse(value) as T) : undefined;
}

const mockProvider = {
  id: 'test',
  name: 'Test',
  provider: 'openai' as const,
  apiKey: 'test-key',
  model: 'gpt-4',
  enabled: true,
};

beforeEach(async () => {
  await __resetSubAgentStateForTests();
  await flushPendingStorageWrites();
  expoFileSystemMock.__resetStore();
  mockAsyncStorageData = {};
  jest.clearAllMocks();
  mockFinalizationStreamMessage.mockReset();
  mockFinalizationStreamMessage.mockImplementation(() => createAsyncEventStream());
  (runOrchestrator as jest.Mock).mockReset();
  (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
    callbacks.onDone?.();
    return Promise.resolve();
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('MAX_SPAWN_DEPTH', () => {
  it('is 5', () => {
    expect(MAX_SPAWN_DEPTH).toBe(5);
  });
});

describe('isToolAllowedBySandbox', () => {
  it('allows everything in "full" mode', () => {
    expect(isToolAllowedBySandbox('ssh_exec', 'full')).toBe(true);
    expect(isToolAllowedBySandbox('workspace_delete', 'full')).toBe(true);
    expect(isToolAllowedBySandbox('any_tool', 'full')).toBe(true);
  });

  it('allows safe tools in "safe-only" mode', () => {
    expect(isToolAllowedBySandbox('read_file', 'safe-only')).toBe(true);
    expect(isToolAllowedBySandbox('memory_search', 'safe-only')).toBe(true);
    expect(isToolAllowedBySandbox('web_search', 'safe-only')).toBe(true);
    expect(isToolAllowedBySandbox('browser_navigate', 'safe-only')).toBe(true);
    expect(isToolAllowedBySandbox('browser_snapshot', 'safe-only')).toBe(true);
  });

  it('blocks dangerous tools in "safe-only" mode', () => {
    expect(isToolAllowedBySandbox('ssh_exec', 'safe-only')).toBe(false);
    expect(isToolAllowedBySandbox('write_file', 'safe-only')).toBe(false);
    expect(isToolAllowedBySandbox('workspace_delete', 'safe-only')).toBe(false);
  });

  it('blocks dynamic MCP and skill tools in "safe-only" mode unless explicitly whitelisted', () => {
    expect(isToolAllowedBySandbox('mcp__docs__search_docs', 'safe-only')).toBe(false);
    expect(isToolAllowedBySandbox('skill__weather__forecast', 'safe-only')).toBe(false);

    const explicitlyAllowedTools = new Set(['mcp__docs__search_docs', 'skill__weather__forecast']);

    expect(
      isToolAllowedBySandbox('mcp__docs__search_docs', 'safe-only', { explicitlyAllowedTools }),
    ).toBe(true);
    expect(
      isToolAllowedBySandbox('skill__weather__forecast', 'safe-only', { explicitlyAllowedTools }),
    ).toBe(true);
    expect(
      isToolAllowedBySandbox('mcp__docs__delete_docs', 'safe-only', { explicitlyAllowedTools }),
    ).toBe(false);
  });

  it('allows everything in "inherit" mode', () => {
    expect(isToolAllowedBySandbox('ssh_exec', 'inherit')).toBe(true);
    expect(isToolAllowedBySandbox('read_file', 'inherit')).toBe(true);
  });
});

describe('spawnSubAgent — depth guard', () => {
  it('rejects when depth >= MAX_SPAWN_DEPTH', async () => {
    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'test',
        depth: MAX_SPAWN_DEPTH,
      },
      mockProvider,
    );

    expect(result.status).toBe('error');
    expect(result.output).toContain('maximum sub-agent spawn depth');
    expect(result.sessionId).toBe('');
  });

  it('succeeds at depth < MAX_SPAWN_DEPTH', async () => {
    // Make runOrchestrator call onDone immediately
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onToken('hello');
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'test task',
        depth: 0,
      },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(result.depth).toBe(1);
    expect(result.output).toBe('hello');
  });
});

describe('announce system', () => {
  it('notifies listeners on spawn start and complete', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    const events: Array<{ event: string; status: string }> = [];
    const unsub = onSubAgentEvent((agent, event) => {
      events.push({ event, status: agent.status });
    });

    await spawnSubAgent({ parentConversationId: 'conv-1', prompt: 'test' }, mockProvider);

    unsub();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'started' }),
        expect.objectContaining({ event: 'completed' }),
      ]),
    );
  });

  it('preserves timeout as a distinct lifecycle event', async () => {
    (runOrchestrator as jest.Mock).mockImplementation(() => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const events: Array<{ event: string; status: string }> = [];
    const unsub = onSubAgentEvent((agent, event) => {
      events.push({ event, status: agent.status });
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-1', prompt: 'test timeout', timeoutMs: 1000 },
      mockProvider,
    );

    unsub();

    expect(result.status).toBe('timeout');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'started' }),
        expect.objectContaining({ event: 'timeout', status: 'timeout' }),
      ]),
    );
  });

  it('unsubscribes correctly', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    const listener = jest.fn();
    const unsub = onSubAgentEvent(listener);
    unsub();

    await spawnSubAgent({ parentConversationId: 'conv-1', prompt: 'test' }, mockProvider);

    expect(listener).not.toHaveBeenCalled();
  });

  it('coalesces rapid progress updates into a single announced snapshot', async () => {
    jest.useFakeTimers();

    let orchestratorCallbacks: any;
    let resolveRun: (() => void) | undefined;
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      orchestratorCallbacks = callbacks;
      return new Promise<void>((resolve) => {
        resolveRun = resolve;
      });
    });

    const events: Array<{ event: string; activity?: string }> = [];
    const unsub = onSubAgentEvent((agent, event) => {
      events.push({ event, activity: agent.currentActivity });
    });

    const started = await startSubAgent(
      { parentConversationId: 'conv-1', prompt: 'Inspect the repository' },
      mockProvider,
    );

    await jest.advanceTimersByTimeAsync(0);
    events.length = 0;

    orchestratorCallbacks.onToolCallStart?.({
      id: 'tc-progress',
      name: 'read_file',
      arguments: '{"path":"README.md"}',
      status: 'running',
    });
    orchestratorCallbacks.onToolCallComplete?.({
      id: 'tc-progress',
      name: 'read_file',
      arguments: '{"path":"README.md"}',
      status: 'completed',
      result: 'Repository inspection complete.',
    });

    expect(events).toEqual([]);

    await jest.advanceTimersByTimeAsync(249);
    expect(events).toEqual([]);

    await jest.advanceTimersByTimeAsync(1);
    expect(events).toEqual([
      expect.objectContaining({
        event: 'progress',
        activity: expect.stringContaining('Latest result from read_file'),
      }),
    ]);

    orchestratorCallbacks.onDone?.();
    resolveRun?.();
    await started.resultPromise;
    unsub();
  });

  it('announces bootstrap progress before the first streamed worker output arrives', async () => {
    jest.useFakeTimers();

    let resolveRun: (() => void) | undefined;
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onStateChange?.('thinking');
      return new Promise<void>((resolve) => {
        resolveRun = () => {
          callbacks.onDone?.();
          resolve();
        };
      });
    });

    const events: Array<{ event: string; activity?: string }> = [];
    const unsub = onSubAgentEvent((agent, event) => {
      events.push({ event, activity: agent.currentActivity });
    });

    const started = await startSubAgent(
      { parentConversationId: 'conv-1', prompt: 'Plan before using tools' },
      mockProvider,
    );

    expect(events).toEqual([
      expect.objectContaining({
        event: 'started',
        activity: 'Queued to start',
      }),
    ]);

    await jest.advanceTimersByTimeAsync(0);
    expect(events).toEqual([
      expect.objectContaining({
        event: 'started',
        activity: 'Queued to start',
      }),
    ]);

    await jest.advanceTimersByTimeAsync(250);
    expect(events).toEqual([
      expect.objectContaining({
        event: 'started',
        activity: 'Queued to start',
      }),
      expect.objectContaining({
        event: 'progress',
        activity: 'Planning task',
      }),
    ]);

    resolveRun?.();
    await started.resultPromise;
    unsub();
  });
});

describe('persistence', () => {
  it('persists the registry to file-backed storage on spawn', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    await spawnSubAgent({ parentConversationId: 'conv-1', prompt: 'test' }, mockProvider);

    await flushPendingStorageWrites(REGISTRY_KEY);
    expect(readPersistedJson(REGISTRY_KEY)).toEqual(expect.any(Array));
  });

  it('persists resumable bounded session context snapshots for completed workers', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onAssistantMessage?.('Repository inspection completed.');
      callbacks.onDone?.();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Inspect the repository',
        systemPrompt: 'You are a focused worker.',
        tools: ['read_file'],
      },
      mockProvider,
      [mockProvider],
    );

    await flushPendingStorageWrites(REGISTRY_CONTEXTS_KEY);
    const storedContexts = readPersistedJson<Record<string, any>>(REGISTRY_CONTEXTS_KEY) ?? {};

    expect(storedContexts[result.sessionId]).toEqual(
      expect.objectContaining({
        conversationSummary: 'Repository inspection completed.',
        config: expect.objectContaining({
          prompt: 'Inspect the repository',
          systemPrompt: 'You are a focused worker.',
          tools: ['read_file'],
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Inspect the repository' }),
          expect.objectContaining({
            role: 'assistant',
            content: 'Repository inspection completed.',
          }),
        ]),
      }),
    );
    expect(storedContexts[result.sessionId].provider).toEqual(
      expect.objectContaining({
        id: mockProvider.id,
        apiKey: '',
      }),
    );
    expect(storedContexts[result.sessionId].allProviders).toEqual([
      expect.objectContaining({
        id: mockProvider.id,
        apiKey: '',
      }),
    ]);
    expect(storedContexts[result.sessionId].systemPrompt).toContain('You are a focused worker.');
    expect(storedContexts[result.sessionId].systemPrompt).toContain('## Worker Contract');
  });

  it('stores attachment metadata and enriched user content without persisting inline attachment bytes', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onAssistantMessage?.('The screenshot shows a dependency install failure.');
      callbacks.onDone?.();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Inspect the attached screenshot',
        initialMessages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Inspect the attached screenshot',
            enrichedContent:
              'Inspect the attached screenshot\n\n<attachment_context>CI log shows npm install failed.</attachment_context>',
            timestamp: 1,
            attachments: [
              {
                id: 'att-1',
                type: 'image',
                uri: 'file:///tmp/screenshot.png',
                name: 'screenshot.png',
                mimeType: 'image/png',
                size: 2048,
                base64: 'should-not-persist',
              },
            ],
          },
        ],
        linkUnderstandingEnabled: true,
        mediaUnderstandingEnabled: true,
      },
      mockProvider,
    );

    await flushPendingStorageWrites(REGISTRY_CONTEXTS_KEY);
    const storedContexts = readPersistedJson<Record<string, any>>(REGISTRY_CONTEXTS_KEY) ?? {};
    const storedUserMessage = storedContexts[result.sessionId]?.messages?.[0];

    expect(storedUserMessage).toEqual(
      expect.objectContaining({
        role: 'user',
        content: 'Inspect the attached screenshot',
        enrichedContent:
          'Inspect the attached screenshot\n\n<attachment_context>CI log shows npm install failed.</attachment_context>',
        attachments: [
          expect.objectContaining({
            id: 'att-1',
            uri: 'file:///tmp/screenshot.png',
          }),
        ],
      }),
    );
    expect(storedUserMessage.attachments[0]).not.toHaveProperty('base64');
    expect(storedContexts[result.sessionId].config).toEqual(
      expect.objectContaining({
        linkUnderstandingEnabled: true,
        mediaUnderstandingEnabled: true,
      }),
    );
  });

  it('passes delegated link and media understanding flags into the worker orchestrator', async () => {
    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Inspect the attachment',
        linkUnderstandingEnabled: true,
        mediaUnderstandingEnabled: false,
      },
      mockProvider,
    );

    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        linkUnderstandingEnabled: true,
        mediaUnderstandingEnabled: false,
      }),
      expect.anything(),
    );
  });

  it('launchSubAgent persists its initial worker snapshot and context before returning', async () => {
    const launched = await launchSubAgent(
      { parentConversationId: 'conv-1', prompt: 'background task' },
      mockProvider,
    );

    expect(launched.status).toBe('running');
    expect(readPersistedJson(REGISTRY_KEY)).toEqual(expect.any(Array));
    expect(
      readPersistedJson<Record<string, unknown>>(REGISTRY_CONTEXTS_KEY)?.[launched.sessionId],
    ).toEqual(
      expect.objectContaining({
        conversationSummary: '',
        messages: [expect.objectContaining({ role: 'user', content: 'background task' })],
      }),
    );
    expect(getSessionContext(launched.sessionId)).toEqual(
      expect.objectContaining({
        conversationSummary: '',
        messages: [expect.objectContaining({ role: 'user', content: 'background task' })],
      }),
    );
  });

  it('normalizes string tool selections before persisting and launching workers', async () => {
    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'research with constrained tools',
        tools: 'web_search, web_fetch' as any,
      },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredTools: ['web_search', 'web_fetch'],
      }),
      expect.anything(),
    );

    await flushPendingStorageWrites(REGISTRY_CONTEXTS_KEY);
    expect(
      readPersistedJson<Record<string, unknown>>(REGISTRY_CONTEXTS_KEY)?.[result.sessionId],
    ).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          tools: ['web_search', 'web_fetch'],
        }),
      }),
    );
    expect(getSessionContext(result.sessionId)).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          tools: ['web_search', 'web_fetch'],
        }),
      }),
    );
  });

  it('continues bootstrapping a deferred worker even when the initial persistence flush is slow', async () => {
    jest.useFakeTimers();

    let resolvePersist: (() => void) | undefined;
    const pendingPersist = new Promise<void>((resolve) => {
      resolvePersist = resolve;
    });
    const flushSpy = jest
      .spyOn(throttledStorageModule, 'flushPendingStorageWrites')
      .mockImplementation(() => pendingPersist);

    (runOrchestrator as jest.Mock).mockImplementationOnce((_cfg: any, callbacks: any) => {
      callbacks.onDone?.();
      return Promise.resolve();
    });

    let startedSettled = false;

    try {
      const startedPromise = startSubAgent(
        { parentConversationId: 'conv-1', prompt: 'slow launch persistence' },
        mockProvider,
      );
      void startedPromise.then(() => {
        startedSettled = true;
      });

      await jest.advanceTimersByTimeAsync(0);

      expect(runOrchestrator).toHaveBeenCalledTimes(1);
      expect(startedSettled).toBe(false);

      await jest.advanceTimersByTimeAsync(2_000);

      const started = await startedPromise;
      expect(started.status).toBe('running');
      await expect(started.resultPromise).resolves.toMatchObject({ status: 'completed' });
    } finally {
      resolvePersist?.();
      flushSpy.mockRestore();
    }
  });

  it('stores the latest assistant summary in session context when the worker completes', async () => {
    jest.useFakeTimers();

    let orchestratorCallbacks: any;
    let resolveRun: (() => void) | undefined;
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      orchestratorCallbacks = callbacks;
      return new Promise<void>((resolve) => {
        resolveRun = resolve;
      });
    });

    const started = await startSubAgent(
      { parentConversationId: 'conv-1', prompt: 'Inspect the repository' },
      mockProvider,
    );

    await jest.advanceTimersByTimeAsync(0);

    orchestratorCallbacks.onAssistantMessage?.('Repository inspection completed.');

    orchestratorCallbacks.onDone?.();
    resolveRun?.();
    await started.resultPromise;

    const context = getSessionContext(started.sessionId);
    expect(context?.conversationSummary).toBe('Repository inspection completed.');
    expect(context?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Repository inspection completed.' }),
      ]),
    );
  });
});

describe('getSubAgentsByParent', () => {
  it('filters by parentConversationId', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    await spawnSubAgent({ parentConversationId: 'conv-A', prompt: 'task A' }, mockProvider);
    await spawnSubAgent({ parentConversationId: 'conv-B', prompt: 'task B' }, mockProvider);

    const aAgents = getSubAgentsByParent('conv-A');
    const bAgents = getSubAgentsByParent('conv-B');

    expect(aAgents.length).toBeGreaterThanOrEqual(1);
    expect(bAgents.length).toBeGreaterThanOrEqual(1);
    expect(aAgents[0].parentConversationId).toBe('conv-A');
    expect(bAgents[0].parentConversationId).toBe('conv-B');
  });
});

describe('detectOrphans', () => {
  it('marks stale running agents as error', async () => {
    // Simulate a stale agent in storage
    const staleAgent: ActiveSubAgent = {
      sessionId: 'stale-1',
      parentConversationId: 'conv-old',
      depth: 0,
      startedAt: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago
      updatedAt: Date.now() - 3 * 60 * 60 * 1000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    writePersistedJson(REGISTRY_KEY, [staleAgent]);

    const orphanCount = await detectOrphans();
    expect(orphanCount).toBe(1);

    const agent = getSubAgent('stale-1');
    expect(agent?.status).toBe('error');
    expect(agent?.output).toContain('app restarted');
  });

  it('marks unresolved running agents as interrupted on app restart even when recently updated', async () => {
    const recentAgent: ActiveSubAgent = {
      sessionId: 'recent-1',
      parentConversationId: 'conv-new',
      depth: 0,
      startedAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    writePersistedJson(REGISTRY_KEY, [recentAgent]);

    const orphanCount = await detectOrphans();
    expect(orphanCount).toBeGreaterThanOrEqual(1);

    const agent = getSubAgent('recent-1');
    expect(agent?.status).toBe('error');
    expect(agent?.output).toContain('app restarted');
  });

  it('restores persisted session context for interrupted workers so follow-up runs can resume with prior context', async () => {
    const now = Date.now();
    const runningAgent: ActiveSubAgent = {
      sessionId: 'recoverable-1',
      parentConversationId: 'conv-recover',
      depth: 0,
      startedAt: now - 60_000,
      updatedAt: now - 30_000,
      status: 'running',
      sandboxPolicy: 'safe-only',
    };

    writePersistedJson(REGISTRY_KEY, [runningAgent]);
    writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      'recoverable-1': {
        config: {
          parentConversationId: 'conv-recover',
          prompt: 'Inspect the API surface',
          systemPrompt: 'You are a focused worker.',
          sandboxPolicy: 'safe-only',
          tools: ['read_file', 'list_files'],
        },
        provider: mockProvider,
        systemPrompt: 'You are a focused worker.',
        conversationSummary: '',
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            content: 'Inspect the API surface',
            timestamp: now - 59_000,
          },
        ],
      },
    });

    await detectOrphans();

    expect(getSubAgent('recoverable-1')?.status).toBe('error');
    expect(getSessionContext('recoverable-1')).toEqual(
      expect.objectContaining({
        systemPrompt: 'You are a focused worker.',
        config: expect.objectContaining({
          prompt: 'Inspect the API surface',
          sandboxPolicy: 'safe-only',
          tools: ['read_file', 'list_files'],
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Inspect the API surface' }),
        ]),
      }),
    );
  });

  it('redacts legacy persisted provider API keys when reloading session context snapshots', async () => {
    const now = Date.now();
    const runningAgent: ActiveSubAgent = {
      sessionId: 'redacted-1',
      parentConversationId: 'conv-redacted',
      depth: 0,
      startedAt: now - 60_000,
      updatedAt: now - 30_000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    writePersistedJson(REGISTRY_KEY, [runningAgent]);
    writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      'redacted-1': {
        config: {
          parentConversationId: 'conv-redacted',
          prompt: 'Resume prior work',
        },
        provider: {
          ...mockProvider,
          apiKey: 'persisted-secret',
        },
        allProviders: [
          {
            ...mockProvider,
            apiKey: 'persisted-secret',
          },
        ],
        systemPrompt: 'You are a focused worker.',
        conversationSummary: 'Prior result',
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            content: 'Resume prior work',
            timestamp: now - 59_000,
          },
        ],
      },
    });

    await detectOrphans();

    expect(getSessionContext('redacted-1')).toEqual(
      expect.objectContaining({
        provider: expect.objectContaining({
          id: mockProvider.id,
          apiKey: '',
        }),
        allProviders: [
          expect.objectContaining({
            id: mockProvider.id,
            apiKey: '',
          }),
        ],
      }),
    );
  });

  it('restores terminal worker state from persisted conversation history before interrupting it', async () => {
    const now = Date.now();
    const runningAgent: ActiveSubAgent = {
      sessionId: 'recovered-1',
      parentConversationId: 'conv-recovered',
      depth: 0,
      startedAt: now - 60_000,
      updatedAt: now - 45_000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };
    const completedSnapshot: ActiveSubAgent = {
      ...runningAgent,
      updatedAt: now - 1_000,
      status: 'completed',
      output: 'Recovered final worker output.',
      toolsUsed: ['read_file'],
    };

    writePersistedJson(REGISTRY_KEY, [runningAgent]);

    await initSubAgentRegistry([
      {
        id: 'conv-recovered',
        title: 'Recovered conversation',
        messages: [
          {
            id: 'msg-worker-complete',
            role: 'assistant',
            content: 'Worker finished the recovery path.',
            timestamp: completedSnapshot.updatedAt,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: completedSnapshot,
            },
          },
        ],
        providerId: 'test',
        systemPrompt: 'system',
        createdAt: now - 120_000,
        updatedAt: completedSnapshot.updatedAt,
      } as any,
    ]);

    const agent = getSubAgent('recovered-1');
    expect(agent?.status).toBe('completed');
    expect(agent?.output).toBe('Recovered final worker output.');
  });
});

describe('initSubAgentRegistry', () => {
  it('loads from storage and detects orphans', async () => {
    writePersistedJson(REGISTRY_KEY, []);
    await initSubAgentRegistry();
    expect(listActiveSubAgents()).toEqual([]);
  });

  it('skips only malformed persisted session contexts and keeps valid siblings', async () => {
    const now = Date.now();
    writePersistedJson(REGISTRY_KEY, [
      {
        sessionId: 'recover-good',
        parentConversationId: 'conv-recover',
        depth: 0,
        startedAt: now - 60_000,
        updatedAt: now - 30_000,
        status: 'running',
        sandboxPolicy: 'inherit',
      },
      {
        sessionId: 'recover-bad',
        parentConversationId: 'conv-recover',
        depth: 0,
        startedAt: now - 55_000,
        updatedAt: now - 25_000,
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ]);
    writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      'recover-good': {
        config: {
          parentConversationId: 'conv-recover',
          prompt: 'Recover the valid worker',
        },
        provider: mockProvider,
        systemPrompt: 'You are a worker.',
        conversationSummary: 'Recovered summary',
        messages: [
          {
            id: 'msg-good',
            role: 'user',
            content: 'Recover the valid worker',
            timestamp: now - 59_000,
          },
        ],
      },
      'recover-bad': {
        config: {
          parentConversationId: 'conv-recover',
          prompt: 'Broken entry',
        },
        provider: mockProvider,
        systemPrompt: 'broken',
        conversationSummary: 'broken',
        messages: 'not-an-array',
      },
    });

    await initSubAgentRegistry();

    expect(getSessionContext('recover-good')).toEqual(
      expect.objectContaining({
        conversationSummary: 'Recovered summary',
        messages: [expect.objectContaining({ role: 'user', content: 'Recover the valid worker' })],
      }),
    );
    expect(getSessionContext('recover-bad')).toBeUndefined();
  });
});

describe('cleanupSubAgents', () => {
  it('retains recently updated terminal workers and only removes stale ones', async () => {
    const now = Date.now();
    writePersistedJson(REGISTRY_KEY, [
      {
        sessionId: 'cleanup-keep-recent',
        parentConversationId: 'conv-cleanup',
        depth: 0,
        startedAt: now - 3 * 60 * 60 * 1000,
        updatedAt: now - 15 * 60 * 1000,
        status: 'completed',
        sandboxPolicy: 'inherit',
        output: 'Recently completed worker output.',
      },
      {
        sessionId: 'cleanup-purge-old',
        parentConversationId: 'conv-cleanup',
        depth: 0,
        startedAt: now - 4 * 60 * 60 * 1000,
        updatedAt: now - 3 * 60 * 60 * 1000,
        status: 'completed',
        sandboxPolicy: 'inherit',
        output: 'Old worker output.',
      },
    ]);

    await initSubAgentRegistry();
    cleanupSubAgents();

    expect(getSubAgent('cleanup-keep-recent')).toEqual(
      expect.objectContaining({
        sessionId: 'cleanup-keep-recent',
        status: 'completed',
      }),
    );
    expect(getSubAgent('cleanup-purge-old')).toBeUndefined();
  });
});

describe('output truncation', () => {
  it('truncates output longer than 8000 chars', async () => {
    const longOutput = 'a'.repeat(10_000);
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onToken(longOutput);
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-1', prompt: 'test' },
      mockProvider,
    );

    expect(result.output.length).toBeLessThanOrEqual(8_000 + 25); // +25 for truncation notice
    expect(result.output).toContain('[Output truncated]');
  });
});

describe('sub-agent preferredTools pass-through', () => {
  it('passes config.tools as preferredTools to runOrchestrator', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Research API endpoints',
        tools: ['web_search', 'web_fetch', 'read_file'],
      },
      mockProvider,
    );

    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredTools: ['web_search', 'web_fetch', 'read_file'],
      }),
      expect.any(Object),
    );
  });

  it('does not pass preferredTools when config.tools is empty', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Do something',
        tools: [],
      },
      mockProvider,
    );

    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredTools: undefined,
      }),
      expect.any(Object),
    );
  });

  it('does not pass preferredTools when config.tools is not provided', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Do something',
      },
      mockProvider,
    );

    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredTools: undefined,
      }),
      expect.any(Object),
    );
  });
});

describe('sessionContext eviction', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAsyncStorageData = {};
    mockIdCounter = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('evicts session context after grace period when agent completes', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onToken('done');
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-evict-1', prompt: 'test' },
      mockProvider,
    );

    // Context should still exist immediately after completion
    expect(getSessionContext(result.sessionId)).toBeDefined();

    // Advance past grace period (60s)
    jest.advanceTimersByTime(61_000);

    // Context should now be evicted
    expect(getSessionContext(result.sessionId)).toBeUndefined();
  });

  it('retains session context within grace period', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onToken('done');
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-evict-2', prompt: 'test' },
      mockProvider,
    );

    // Context should still exist within grace period
    jest.advanceTimersByTime(30_000);
    expect(getSessionContext(result.sessionId)).toBeDefined();
  });

  it('does not evict terminal session context after a failed persistence flush', async () => {
    const flushSpy = jest
      .spyOn(throttledStorageModule, 'flushPendingStorageWrites')
      .mockRejectedValue(new Error('disk full'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onToken('done');
      callbacks.onDone();
      return Promise.resolve();
    });

    try {
      const result = await spawnSubAgent(
        { parentConversationId: 'conv-evict-4', prompt: 'test' },
        mockProvider,
      );

      expect(getSessionContext(result.sessionId)).toBeDefined();

      jest.advanceTimersByTime(61_000);

      expect(getSessionContext(result.sessionId)).toBeDefined();
    } finally {
      flushSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('cancels eviction when cleanupSubAgents removes the agent', async () => {
    const now = Date.now();
    writePersistedJson(REGISTRY_KEY, [
      {
        sessionId: 'evict-cleanup-1',
        parentConversationId: 'conv-evict-3',
        depth: 0,
        startedAt: now - 4 * 60 * 60 * 1000,
        updatedAt: now - 3 * 60 * 60 * 1000,
        status: 'completed',
        sandboxPolicy: 'inherit',
        output: 'Old completed output',
      },
    ]);
    await initSubAgentRegistry();

    // Cleanup should remove stale agent and its eviction timer
    cleanupSubAgents();
    expect(getSubAgent('evict-cleanup-1')).toBeUndefined();
  });
});
