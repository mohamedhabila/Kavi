import {
  flushPendingStorageWrites,
  getSessionContext,
  installSubAgentDurabilityHarness,
  launchSubAgent,
  mockProvider,
  readPersistedJson,
  REGISTRY_CONTEXTS_KEY,
  REGISTRY_KEY,
  runOrchestrator,
  spawnSubAgent,
  startSubAgent,
  throttledStorageModule,
} from '../helpers/subAgentDurabilityHarness';

installSubAgentDurabilityHarness();

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
        prompt: 'inspect with constrained tools',
        tools: 'web_search, web_fetch' as any,
      },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        toolFilter: expect.any(Function),
      }),
      expect.anything(),
    );

    const callOptions = (runOrchestrator as jest.Mock).mock.calls[0][0];
    expect(callOptions.toolFilter('web_search')).toBe(true);
    expect(callOptions.toolFilter('web_fetch')).toBe(true);
    expect(callOptions.toolFilter('read_file')).toBe(false);

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
