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
  it('hooks callback uses the selected active model when it differs from the provider default', async () => {
    jest.doMock('../../src/store/useSettingsStore', () => ({
      useSettingsStore: {
        getState: () => ({
          activeProviderId: 'openai',
          activeModel: 'gpt-4o-mini',
          providers: [
            {
              ...mockProvider,
              model: 'gpt-5.4',
              availableModels: ['gpt-5.4', 'gpt-4o-mini'],
              enabled: true,
            },
          ],
          systemPrompt: 'You are helpful.',
          thinkingLevel: 'medium',
          linkUnderstandingEnabled: true,
          mediaUnderstandingEnabled: true,
          maxLinks: 3,
        }),
      },
    }));

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const hookCallback = mockLoadHooksFromDirectory.mock.calls[0][0];
    await hookCallback('test prompt', {});

    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    const [opts] = mockRunOrchestrator.mock.calls[0];
    expect(opts.model).toBe('gpt-4o-mini');
  });
  it('hooks callback does nothing without active provider', async () => {
    jest.doMock('../../src/store/useSettingsStore', () => ({
      useSettingsStore: {
        getState: () => ({ activeProviderId: 'missing', providers: [] }),
      },
    }));
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const hookCallback = mockLoadHooksFromDirectory.mock.calls[0][0];
    await hookCallback('test prompt', {});
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });
  it('hooks callback does nothing without api key', async () => {
    mockGetProviderApiKey.mockResolvedValue('');
    jest.doMock('../../src/store/useSettingsStore', () => ({
      useSettingsStore: {
        getState: () => ({
          activeProviderId: 'openai',
          providers: [
            { id: 'openai', name: 'OpenAI', apiKey: '', model: 'gpt-5.4', enabled: true },
          ],
        }),
      },
    }));
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const hookCallback = mockLoadHooksFromDirectory.mock.calls[0][0];
    await hookCallback('test prompt', {});
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });
  it('runs boot when BOOT.md exists', async () => {
    mockHasBootMd.mockResolvedValueOnce(true);
    jest.doMock('../../src/store/useSettingsStore', () => ({
      useSettingsStore: {
        getState: () => ({
          activeProviderId: 'openai',
          providers: [{ ...mockProvider, enabled: true }],
        }),
      },
    }));
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    // Wait for async IIFE
    await new Promise((r) => setTimeout(r, 50));
    expect(mockHasBootMd).toHaveBeenCalled();
    expect(mockRunBootOnce).toHaveBeenCalledTimes(1);
  });
  it('passes the selected active model into boot execution when it differs from the provider default', async () => {
    mockHasBootMd.mockResolvedValueOnce(true);
    jest.doMock('../../src/store/useSettingsStore', () => ({
      useSettingsStore: {
        getState: () => ({
          activeProviderId: 'openai',
          activeModel: 'gpt-4o-mini',
          providers: [
            {
              ...mockProvider,
              model: 'gpt-5.4',
              availableModels: ['gpt-5.4', 'gpt-4o-mini'],
              enabled: true,
            },
          ],
        }),
      },
    }));

    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRunBootOnce).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai' }),
      expect.any(Array),
      'gpt-4o-mini',
    );
  });
  it('skips boot when BOOT.md does not exist', async () => {
    mockHasBootMd.mockResolvedValueOnce(false);
    jest.doMock('../../src/store/useSettingsStore', () => ({
      useSettingsStore: {
        getState: () => ({
          activeProviderId: 'openai',
          providers: [{ ...mockProvider, enabled: true }],
        }),
      },
    }));
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockHasBootMd).toHaveBeenCalled();
    expect(mockRunBootOnce).not.toHaveBeenCalled();
  });
  it('boot runner handles errors silently', async () => {
    mockHasBootMd.mockRejectedValueOnce(new Error('fail'));
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    await new Promise((r) => setTimeout(r, 50));
    // Should not throw
    expect(mockRunBootOnce).not.toHaveBeenCalled();
  });
});
