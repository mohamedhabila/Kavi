const mockRegisterBuiltInServiceSkills = jest.fn();
const mockActivateEnabledSkills = jest.fn();
const mockSetSchedulerExecutor = jest.fn();
const mockStartScheduler = jest.fn();
const mockEvaluateJobsOnce = jest.fn().mockResolvedValue(undefined);
const mockRegisterBackgroundFetch = jest.fn().mockResolvedValue(undefined);
const mockSyncSchedulerWakeNotifications = jest.fn().mockResolvedValue(undefined);
const mockRunBootOnce = jest.fn().mockResolvedValue(undefined);
const mockHasBootMd = jest.fn().mockResolvedValue(false);
const mockLoadHooksFromDirectory = jest.fn().mockResolvedValue(undefined);
const mockRunOrchestrator = jest.fn().mockResolvedValue(undefined);
const mockGetProviderApiKey = jest.fn().mockResolvedValue('sk-test');
const mockInitializeNotifications = jest.fn().mockResolvedValue(undefined);
const mockSendLocalNotification = jest.fn().mockResolvedValue({ id: 'notif-1', scheduled: false });
const mockConnectAll = jest.fn().mockResolvedValue(undefined);
const mockInitSubAgentRegistry = jest.fn().mockResolvedValue(undefined);
const mockListActiveSubAgents = jest.fn().mockReturnValue([]);
const mockRepairTerminalAgentRunsMissingFinalResponses = jest.fn().mockResolvedValue([]);
const mockHydrateCanvasSurfaces = jest.fn().mockResolvedValue(undefined);
const mockEmitAppEvent = jest.fn().mockResolvedValue(undefined);
const mockRunMemoryMigrationTick = jest.fn().mockResolvedValue(undefined);
const mockRunMemoryBackgroundFlush = jest.fn().mockResolvedValue(undefined);
const originalRequestIdleCallback = (global as any).requestIdleCallback;
const { waitFor } = require('@testing-library/react-native');
const mockChatStoreState = {
  conversations: [] as any[],
  activeConversationId: 'active-conversation',
  createConversation: jest.fn(),
  getOrCreateCanonicalThread: jest.fn(),
  updateModelInConversation: jest.fn(),
  addMessage: jest.fn(),
  updateMessage: jest.fn(),
  updateMessageEnrichedContent: jest.fn(),
  updateMessageReasoning: jest.fn(),
  updateMessageProviderReplay: jest.fn(),
  updateMessageAssistantMetadata: jest.fn(),
  addToolCall: jest.fn(),
  updateToolCallStatus: jest.fn(),
  recoverInterruptedAgentRuns: jest.fn(),
};
const mockProvider = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-5.4',
  enabled: true,
};
jest.mock('../../src/services/integrations/registry', () => ({
  registerBuiltInServiceSkills: mockRegisterBuiltInServiceSkills,
}));
jest.mock('../../src/services/skills/manager', () => ({
  activateEnabledSkills: (...args: any[]) => mockActivateEnabledSkills(...args),
}));
jest.mock('../../src/services/scheduler/engine', () => ({
  setSchedulerExecutor: mockSetSchedulerExecutor,
  startScheduler: mockStartScheduler,
  evaluateJobsOnce: (...args: any[]) => mockEvaluateJobsOnce(...args),
}));
jest.mock('../../src/engine/tools/index', () => ({
  executeTool: jest.fn(),
}));
jest.mock('../../src/services/scheduler/background', () => ({
  registerBackgroundFetch: (...args: any[]) => mockRegisterBackgroundFetch(...args),
  isBackgroundFetchRegistered: jest.fn().mockReturnValue(false),
}));
jest.mock('../../src/services/scheduler/wakeNotifications', () => ({
  syncSchedulerWakeNotifications: (...args: any[]) => mockSyncSchedulerWakeNotifications(...args),
}));
jest.mock('../../src/services/agents/bootRunner', () => ({
  runBootOnce: (...args: any[]) => mockRunBootOnce(...args),
  hasBootMd: (...args: any[]) => mockHasBootMd(...args),
}));
jest.mock('../../src/services/hooks/loader', () => ({
  loadHooksFromDirectory: (...args: any[]) => mockLoadHooksFromDirectory(...args),
}));
jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: (...args: any[]) => mockRunOrchestrator(...args),
}));
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: (...args: any[]) => mockGetProviderApiKey(...args),
}));
jest.mock('../../src/services/notifications/service', () => ({
  initializeNotifications: (...args: any[]) => mockInitializeNotifications(...args),
  sendLocalNotification: (...args: any[]) => mockSendLocalNotification(...args),
}));
jest.mock('../../src/services/canvas/renderer', () => ({
  hydrateCanvasSurfaces: (...args: any[]) => mockHydrateCanvasSurfaces(...args),
}));
jest.mock('../../src/services/events/bus', () => ({
  emitAppEvent: (...args: any[]) => mockEmitAppEvent(...args),
}));
jest.mock('../../src/services/memory/lifecycle', () => ({
  runMemoryMigrationTick: (...args: any[]) => mockRunMemoryMigrationTick(...args),
  runMemoryBackgroundFlush: (...args: any[]) => mockRunMemoryBackgroundFlush(...args),
}));
jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    connectAll: (...args: any[]) => mockConnectAll(...args),
  },
}));
jest.mock('../../src/services/agents/subAgent', () => ({
  initSubAgentRegistry: (...args: any[]) => mockInitSubAgentRegistry(...args),
  listActiveSubAgents: (...args: any[]) => mockListActiveSubAgents(...args),
}));
jest.mock('../../src/services/agents/agentRunRepair', () => ({
  repairTerminalAgentRunsMissingFinalResponses: (...args: any[]) =>
    mockRepairTerminalAgentRunsMissingFinalResponses(...args),
}));
jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      mcpServers: [
        {
          id: 'mcp-1',
          name: 'Petstore',
          url: 'https://petstore.run.mcp.com.ai/mcp',
          enabled: true,
        },
      ],
      activeProviderId: 'openai',
      activeModel: 'gpt-5.4',
      providers: [mockProvider],
      systemPrompt: 'You are helpful.',
      defaultConversationMode: 'agentic',
      thinkingLevel: 'medium',
      linkUnderstandingEnabled: true,
      mediaUnderstandingEnabled: true,
      maxLinks: 3,
    }),
    persist: {
      hasHydrated: () => true,
      onFinishHydration: () => () => {},
    },
  },
}));
jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => mockChatStoreState,
    persist: {
      hasHydrated: () => true,
      onFinishHydration: () => () => {},
    },
  },
}));
jest.mock('../../src/utils/id', () => ({
  generateId: jest
    .fn()
    .mockReturnValueOnce('generated-user-message')
    .mockReturnValueOnce('generated-assistant-message')
    .mockReturnValue('generated-id'),
}));
beforeEach(() => {
  jest.clearAllMocks();
  (global as any).requestIdleCallback = jest.fn((callback: () => void) => {
    callback();
    return 1;
  });
  mockChatStoreState.conversations = [];
  mockChatStoreState.activeConversationId = 'active-conversation';
  mockListActiveSubAgents.mockReturnValue([]);
  mockRepairTerminalAgentRunsMissingFinalResponses.mockResolvedValue([]);
  mockEvaluateJobsOnce.mockResolvedValue(undefined);
  mockSyncSchedulerWakeNotifications.mockResolvedValue(undefined);
  mockChatStoreState.createConversation.mockImplementation(
    (providerId, systemPrompt, modelOverride, options) => {
      const id = `conv-${mockChatStoreState.conversations.length + 1}`;
      mockChatStoreState.conversations.unshift({
        id,
        providerId,
        systemPrompt,
        modelOverride,
        messages: [],
      });
      if (options?.activate !== false) {
        mockChatStoreState.activeConversationId = id;
      }
      return id;
    },
  );
  mockChatStoreState.getOrCreateCanonicalThread.mockImplementation(
    (providerId, systemPrompt, modelOverride) => {
      const existing = mockChatStoreState.conversations.find(
        (conversation) =>
          conversation.providerId === providerId &&
          conversation.systemPrompt === systemPrompt &&
          conversation.modelOverride === modelOverride,
      );
      if (existing) {
        return existing.id;
      }

      const id = `canonical-${mockChatStoreState.conversations.length + 1}`;
      mockChatStoreState.conversations.unshift({
        id,
        providerId,
        systemPrompt,
        modelOverride,
        messages: [],
      });
      return id;
    },
  );
  mockChatStoreState.updateModelInConversation.mockImplementation(
    (conversationId, providerId, model) => {
      mockChatStoreState.conversations = mockChatStoreState.conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, providerId, modelOverride: model }
          : conversation,
      );
    },
  );
  mockChatStoreState.addMessage.mockImplementation((conversationId, message) => {
    mockChatStoreState.conversations = mockChatStoreState.conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            messages: [...conversation.messages, { ...message, timestamp: 1 }],
          }
        : conversation,
    );
  });
  mockChatStoreState.updateMessage.mockImplementation((conversationId, messageId, content) => {
    mockChatStoreState.conversations = mockChatStoreState.conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            messages: conversation.messages.map((message: any) =>
              message.id === messageId ? { ...message, content } : message,
            ),
          }
        : conversation,
    );
  });
  mockChatStoreState.updateMessageEnrichedContent.mockImplementation(
    (conversationId, messageId, enrichedContent) => {
      mockChatStoreState.conversations = mockChatStoreState.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message: any) =>
                message.id === messageId ? { ...message, enrichedContent } : message,
              ),
            }
          : conversation,
      );
    },
  );
  mockChatStoreState.updateMessageProviderReplay.mockImplementation(
    (conversationId, messageId, providerReplay) => {
      mockChatStoreState.conversations = mockChatStoreState.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message: any) =>
                message.id === messageId ? { ...message, providerReplay } : message,
              ),
            }
          : conversation,
      );
    },
  );
  mockChatStoreState.updateMessageAssistantMetadata.mockImplementation(
    (conversationId, messageId, assistantMetadata) => {
      mockChatStoreState.conversations = mockChatStoreState.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message: any) =>
                message.id === messageId ? { ...message, assistantMetadata } : message,
              ),
            }
          : conversation,
      );
    },
  );
  // Reset module to clear `initialized` flag
  jest.resetModules();
  mockRunOrchestrator.mockImplementation(async (options, callbacks) => {
    const lastMessage = options.messages[options.messages.length - 1];
    callbacks.onAssistantMessage(`Result for ${lastMessage.content}`);
    callbacks.onDone();
  });
});
afterAll(() => {
  if (typeof originalRequestIdleCallback === 'function') {
    (global as any).requestIdleCallback = originalRequestIdleCallback;
    return;
  }

  delete (global as any).requestIdleCallback;
});

describe('initializeServices', () => {
  it('surfaces worker output directly during scheduled jobs without rewriting it onto the tool turn', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onToolCallStart?.({
        id: 'tc-surface',
        name: 'sessions_surface_output',
        arguments: '{"sessionId":"worker-1"}',
        status: 'running',
      });
      callbacks.onToolCallComplete?.({
        id: 'tc-surface',
        name: 'sessions_surface_output',
        arguments: '{"sessionId":"worker-1"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'surfaced',
          sessionId: 'worker-1',
          output: 'Worker-authored final answer',
          outputLength: 26,
          sourceOutputLength: 26,
          selectionApplied: false,
          usedFullOutput: true,
          guidance:
            'This output is intended to be surfaced directly to the user by the runtime. Do not restate the same content in assistant text unless you are adding materially new information.',
        }),
      });
      callbacks.onToolMessage?.('tc-surface', 'tool result');
      callbacks.onAssistantMessage?.('Worker-authored final answer');
      callbacks.onDone?.();
    });

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute({
      name: 'Surface Worker Job',
      payload: { prompt: 'Use the worker answer' },
      sessionTarget: 'isolated',
      wakeMode: 'new',
      delivery: { mode: 'conversation' },
    });

    expect(mockChatStoreState.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: 'tool',
        content:
          'Full worker output from worker-1 was surfaced to the user in the assistant response.',
        toolCallId: 'tc-surface',
      }),
    );
    expect(mockChatStoreState.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: 'assistant',
        content: 'Worker-authored final answer',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'surfaced_worker_output_pending',
        }),
      }),
    );
    expect(mockChatStoreState.updateMessage).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'Worker-authored final answer',
    );
  });
  it('sends failure notifications for scheduled jobs', async () => {
    mockRunOrchestrator.mockRejectedValueOnce(new Error('boom'));

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await expect(
      executor.execute({
        name: 'Broken Job',
        payload: { prompt: 'Fail' },
        sessionTarget: 'isolated',
        wakeMode: 'new',
        delivery: { mode: 'both' },
      }),
    ).rejects.toThrow('boom');

    expect(mockSendLocalNotification).toHaveBeenCalledWith({
      title: 'Broken Job',
      body: 'Error: boom',
      data: {
        screen: 'Chat',
        conversationId: 'conv-1',
        source: 'scheduled_task',
      },
    });
  });
  it('executor reuses the active conversation for main/continue jobs', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    mockChatStoreState.conversations = [
      {
        id: 'active-conversation',
        providerId: 'openai',
        systemPrompt: 'You are helpful.',
        modelOverride: 'gpt-5.4',
        messages: [],
      },
    ];

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute({
      name: 'Continue Job',
      payload: { prompt: 'Continue existing thread' },
      sessionTarget: 'main',
      wakeMode: 'continue',
    });

    expect(mockChatStoreState.createConversation).not.toHaveBeenCalled();
    expect(mockChatStoreState.updateModelInConversation).toHaveBeenCalledWith(
      'active-conversation',
      'openai',
      'gpt-5.4',
    );
  });
  it('executor materializes the canonical conversation for main/new jobs', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute({
      name: 'Main Job',
      payload: { prompt: 'Use the main thread' },
      sessionTarget: 'main',
      wakeMode: 'new',
    });

    expect(mockChatStoreState.getOrCreateCanonicalThread).toHaveBeenCalledWith(
      'openai',
      'You are helpful.',
      'gpt-5.4',
      {
        activate: false,
        personaId: 'super-agent',
        mode: 'agentic',
      },
    );
    expect(mockChatStoreState.createConversation).not.toHaveBeenCalled();
    expect(mockChatStoreState.updateModelInConversation).toHaveBeenCalledWith(
      'canonical-1',
      'openai',
      'gpt-5.4',
    );
  });
  it('executor rejects jobs with missing prompt', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await expect(executor.execute({ name: 'Empty', payload: {} })).rejects.toThrow(
      'missing a prompt',
    );
  });
  it('calls registerBackgroundFetch', () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    expect(mockRegisterBackgroundFetch).toHaveBeenCalledTimes(1);
  });
  it('defers non-critical startup work until idle time', () => {
    const scheduledCallbacks: Array<() => void> = [];
    (global as any).requestIdleCallback = jest.fn((callback: () => void) => {
      scheduledCallbacks.push(callback);
      return 1;
    });

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    expect(mockRegisterBuiltInServiceSkills).toHaveBeenCalledTimes(1);
    expect(mockActivateEnabledSkills).toHaveBeenCalledTimes(1);
    expect(mockSetSchedulerExecutor).toHaveBeenCalledTimes(1);
    expect(mockStartScheduler).toHaveBeenCalledTimes(1);
    expect(mockHydrateCanvasSurfaces).not.toHaveBeenCalled();
    expect(mockInitializeNotifications).not.toHaveBeenCalled();
    expect(mockRegisterBackgroundFetch).not.toHaveBeenCalled();
    expect(mockLoadHooksFromDirectory).not.toHaveBeenCalled();
    expect(mockEmitAppEvent).not.toHaveBeenCalled();
    expect(mockHasBootMd).not.toHaveBeenCalled();

    expect(scheduledCallbacks).toHaveLength(1);
    scheduledCallbacks[0]();

    expect(mockHydrateCanvasSurfaces).toHaveBeenCalledTimes(1);
    expect(mockInitializeNotifications).toHaveBeenCalledTimes(1);
    expect(mockRegisterBackgroundFetch).toHaveBeenCalledTimes(1);
    expect(mockLoadHooksFromDirectory).toHaveBeenCalledTimes(1);
    expect(mockHasBootMd).toHaveBeenCalledTimes(1);
  });
  it('unrefs the approval sweep interval when supported', () => {
    const unref = jest.fn();
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as any);

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(unref).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
  });
  it('calls loadHooksFromDirectory with a callback', () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    expect(mockLoadHooksFromDirectory).toHaveBeenCalledTimes(1);
    expect(typeof mockLoadHooksFromDirectory.mock.calls[0][0]).toBe('function');
  });
  it('emits launch only after startup hooks finish loading', async () => {
    let resolveHooks: (() => void) | undefined;
    mockLoadHooksFromDirectory.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveHooks = resolve;
        }),
    );

    const scheduledCallbacks: Array<() => void> = [];
    (global as any).requestIdleCallback = jest.fn((callback: () => void) => {
      scheduledCallbacks.push(callback);
      return 1;
    });

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    scheduledCallbacks[0]();
    expect(mockLoadHooksFromDirectory).toHaveBeenCalledTimes(1);
    expect(mockEmitAppEvent).not.toHaveBeenCalled();

    resolveHooks?.();
    await waitFor(() => expect(mockEmitAppEvent).toHaveBeenCalledWith('launch'));
  });
  it('hooks callback runs orchestrator with provider', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const hookCallback = mockLoadHooksFromDirectory.mock.calls[0][0];
    await hookCallback('test prompt', {});
    expect(mockGetProviderApiKey).toHaveBeenCalledWith('openai');
    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    const [opts] = mockRunOrchestrator.mock.calls[0];
    expect(opts.provider.apiKey).toBe('sk-test');
  });
});
