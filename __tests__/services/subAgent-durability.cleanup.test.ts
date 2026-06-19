import {
  cleanupSubAgents,
  getSessionContext,
  getSubAgent,
  initSubAgentRegistry,
  installSubAgentDurabilityHarness,
  mockProvider,
  REGISTRY_KEY,
  resetSubAgentDurabilityMockState,
  runOrchestrator,
  spawnSubAgent,
  throttledStorageModule,
  writePersistedJson,
} from '../helpers/subAgentDurabilityHarness';

installSubAgentDurabilityHarness();

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

describe('sessionContext eviction', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetSubAgentDurabilityMockState();
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
