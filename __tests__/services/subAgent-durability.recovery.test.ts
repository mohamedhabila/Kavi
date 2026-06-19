import {
  detectOrphans,
  getSessionContext,
  getSubAgent,
  getSubAgentsByParent,
  initSubAgentRegistry,
  installSubAgentDurabilityHarness,
  listActiveSubAgents,
  mockProvider,
  REGISTRY_CONTEXTS_KEY,
  REGISTRY_KEY,
  runOrchestrator,
  spawnSubAgent,
  type ActiveSubAgent,
  writePersistedJson,
} from '../helpers/subAgentDurabilityHarness';

installSubAgentDurabilityHarness();

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
