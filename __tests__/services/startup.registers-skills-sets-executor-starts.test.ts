const mockRegisterBuiltInServiceSkills = jest.fn();
const mockActivateEnabledSkills = jest.fn();
const mockSetSchedulerExecutor = jest.fn();
const mockStartScheduler = jest.fn();
const mockRegisterBackgroundFetch = jest.fn().mockResolvedValue(undefined);
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
}));
jest.mock('../../src/engine/tools/index', () => ({
  executeTool: jest.fn(),
}));
jest.mock('../../src/services/scheduler/background', () => ({
  registerBackgroundFetch: (...args: any[]) => mockRegisterBackgroundFetch(...args),
  isBackgroundFetchRegistered: jest.fn().mockReturnValue(false),
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
  it('registers skills, sets executor, and starts scheduler', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    expect(mockRegisterBuiltInServiceSkills).toHaveBeenCalledTimes(1);
    expect(mockActivateEnabledSkills).toHaveBeenCalledTimes(1);
    expect(mockInitializeNotifications).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockConnectAll).toHaveBeenCalledWith([
        {
          id: 'mcp-1',
          name: 'Petstore',
          url: 'https://petstore.run.mcp.com.ai/mcp',
          enabled: true,
        },
      ]),
    );
    expect(mockSetSchedulerExecutor).toHaveBeenCalledTimes(1);
    expect(mockStartScheduler).toHaveBeenCalledTimes(1);
  });
  it('recovers persisted worker and workflow state on startup', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    await waitFor(() => {
      expect(mockInitSubAgentRegistry).toHaveBeenCalledWith(mockChatStoreState.conversations);
    });
    expect(mockChatStoreState.recoverInterruptedAgentRuns).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ timestamp: expect.any(Number) }),
    );
    expect(mockRepairTerminalAgentRunsMissingFinalResponses).toHaveBeenCalledWith({
      activeSubAgents: [],
    });
  });
  it('only initializes once (idempotent)', () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    initializeServices();
    initializeServices();

    expect(mockRegisterBuiltInServiceSkills).toHaveBeenCalledTimes(1);
    expect(mockActivateEnabledSkills).toHaveBeenCalledTimes(1);
    expect(mockStartScheduler).toHaveBeenCalledTimes(1);
  });
  it('passes an executor with execute function', () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    expect(executor).toHaveProperty('execute');
    expect(typeof executor.execute).toBe('function');
  });
  it('executor runs scheduled jobs through the orchestrator and returns the result', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    const result = await executor.execute({
      name: 'Test Job',
      payload: { prompt: 'Summarize news' },
      sessionTarget: 'isolated',
      wakeMode: 'new',
    });
    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockChatStoreState.createConversation).toHaveBeenCalledWith(
      'openai',
      'You are helpful.',
      'gpt-5.4',
      {
        activate: false,
        personaId: 'super-agent',
        mode: 'agentic',
      },
    );
    expect(mockSendLocalNotification).toHaveBeenCalledWith({
      title: 'Test Job',
      body: 'Result for Summarize news',
      data: {
        screen: 'Chat',
        conversationId: 'conv-1',
        source: 'scheduled_task',
      },
    });
    expect(result).toBe('Result for Summarize news');
  });
  it('persists tool messages generated during scheduled jobs', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onToolMessage('tc-1', 'tool result');
      callbacks.onAssistantMessage('done');
      callbacks.onDone();
    });

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute({
      name: 'Tool Job',
      payload: { prompt: 'Run tool' },
      sessionTarget: 'isolated',
      wakeMode: 'new',
      delivery: { mode: 'both' },
    });

    expect(mockChatStoreState.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'tool', toolCallId: 'tc-1', content: 'tool result' }),
    );
  });
  it('persists providerReplay for empty-content assistant tool turns during scheduled jobs', async () => {
    const providerReplay = {
      geminiParts: [
        {
          functionCall: { id: 'tc-1', name: 'read_file', args: { path: 'a.txt' } },
          thoughtSignature: 'sig-A',
        },
      ],
    };

    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage('', [], providerReplay as any);
      callbacks.onDone();
    });

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute({
      name: 'Gemini Tool Job',
      payload: { prompt: 'Continue tool loop' },
      sessionTarget: 'isolated',
      wakeMode: 'new',
      delivery: { mode: 'conversation' },
    });

    expect(mockChatStoreState.updateMessageProviderReplay).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      providerReplay,
    );
  });
  it('marks JSON error tool messages as errors during scheduled jobs', async () => {
    const payload = JSON.stringify({ status: 'error', error: 'Missing surface' });
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onToolMessage('tc-2', payload);
      callbacks.onAssistantMessage('done');
      callbacks.onDone();
    });

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute({
      name: 'Tool Error Job',
      payload: { prompt: 'Run failing tool' },
      sessionTarget: 'isolated',
      wakeMode: 'new',
      delivery: { mode: 'conversation' },
    });

    expect(mockChatStoreState.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'tc-2',
        content: payload,
        isError: true,
      }),
    );
  });
  it('persists enriched user content generated during scheduled jobs', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onUserMessageEnriched?.(
        'generated-user-message',
        'Prompt\n\n<link_context>Rich page content</link_context>',
      );
      callbacks.onAssistantMessage('done');
      callbacks.onDone();
    });

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();

    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute({
      name: 'Link Job',
      payload: { prompt: 'Prompt' },
      sessionTarget: 'isolated',
      wakeMode: 'new',
      delivery: { mode: 'conversation' },
    });

    expect(mockChatStoreState.updateMessageEnrichedContent).toHaveBeenCalledWith(
      expect.any(String),
      'generated-user-message',
      'Prompt\n\n<link_context>Rich page content</link_context>',
    );
  });
});
