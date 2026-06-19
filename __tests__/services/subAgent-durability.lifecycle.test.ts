import {
  installSubAgentDurabilityHarness,
  isToolAllowedBySandbox,
  MAX_SPAWN_DEPTH,
  mockProvider,
  onSubAgentEvent,
  runOrchestrator,
  spawnSubAgent,
  startSubAgent,
} from '../helpers/subAgentDurabilityHarness';

installSubAgentDurabilityHarness();

describe('MAX_SPAWN_DEPTH', () => {
  it('is 2 for mobile-bounded spawning', () => {
    expect(MAX_SPAWN_DEPTH).toBe(2);
  });
});

describe('isToolAllowedBySandbox', () => {
  it('allows everything in "full" mode', () => {
    expect(isToolAllowedBySandbox('ssh_exec', 'full')).toBe(true);
    expect(isToolAllowedBySandbox('workspace_delegate_task', 'full')).toBe(true);
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
    expect(isToolAllowedBySandbox('workspace_delegate_task', 'safe-only')).toBe(false);
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

describe('spawnSubAgent — concurrent guard', () => {
  it('rejects a second concurrent worker for the same parent conversation', async () => {
    (runOrchestrator as jest.Mock).mockImplementation(
      (_cfg: any, callbacks: any) =>
        new Promise((resolve) => {
          setTimeout(() => {
            callbacks.onDone();
            resolve(undefined);
          }, 50);
        }),
    );

    const started = await startSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'first worker',
        depth: 0,
        announce: false,
      },
      mockProvider,
    );

    expect(started.status).toBe('running');

    const blocked = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'second worker',
        depth: 0,
        announce: false,
      },
      mockProvider,
    );

    expect(blocked.status).toBe('error');
    expect(blocked.output).toContain('Only 1 concurrent sub-agent');

    await started.resultPromise;
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

  it('coalesces rapid worker status updates into a single announced snapshot', async () => {
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

    expect(result.output.length).toBeLessThanOrEqual(8_000);
    expect(result.output).toBe('a'.repeat(8_000));
  });
});

describe('sub-agent toolFilter pass-through', () => {
  it('uses config.tools to build the worker tool surface passed to runOrchestrator', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Inspect API endpoints',
        tools: ['web_search', 'web_fetch', 'read_file'],
      },
      mockProvider,
    );

    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        toolFilter: expect.any(Function),
      }),
      expect.any(Object),
    );

    const callOptions = (runOrchestrator as jest.Mock).mock.calls[0][0];
    expect(callOptions.toolFilter('web_search')).toBe(true);
    expect(callOptions.toolFilter('web_fetch')).toBe(true);
    expect(callOptions.toolFilter('read_file')).toBe(true);
    expect(callOptions.toolFilter('write_file')).toBe(false);
  });

  it('treats an explicit empty config.tools list as a no-tools whitelist', async () => {
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
        toolFilter: expect.any(Function),
      }),
      expect.any(Object),
    );

    const callOptions = (runOrchestrator as jest.Mock).mock.calls[0][0];
    expect(callOptions.toolFilter('web_search')).toBe(false);
    expect(callOptions.toolFilter('record_workflow_evidence')).toBe(false);
  });

  it('does not pass a worker toolFilter when config.tools is not provided', async () => {
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
        toolFilter: undefined,
      }),
      expect.any(Object),
    );
  });
});
