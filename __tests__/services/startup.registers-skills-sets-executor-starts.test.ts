import { claimedSchedulerJob } from '../helpers/schedulerClaimedJobFixture';
import { restoreRequestIdleCallback } from '../helpers/idleCallbackFixture';
import {
  completeFinalMetadata,
  completedOrchestratorRun,
  mockStartupScheduledExecutionCheckpoint,
  startupTestProvider as mockProvider,
} from '../helpers/startupSchedulerRuntimeFixtures';

const mockRegisterBuiltInServiceSkills = jest.fn();
const mockActivateEnabledSkills = jest.fn();
const mockSetSchedulerExecutor = jest.fn();
const mockStartScheduler = jest.fn().mockResolvedValue(undefined);
const mockStopScheduler = jest.fn();
const mockEvaluateJobsOnce = jest.fn().mockResolvedValue(undefined);
const mockRegisterBackgroundFetch = jest.fn().mockResolvedValue(undefined);
const mockSyncSchedulerWakeNotifications = jest.fn().mockResolvedValue({ warnings: [] });
const mockRunBootOnce = jest.fn().mockResolvedValue({ status: 'ran' });
const mockHasBootMd = jest.fn().mockResolvedValue(false);
const mockLoadHooksFromDirectory = jest.fn().mockResolvedValue(undefined);
const mockRunOrchestrator = jest.fn().mockResolvedValue(completedOrchestratorRun);
const mockGetProviderApiKey = jest.fn().mockResolvedValue('sk-test');
const mockInitializeNotifications = jest.fn().mockResolvedValue(undefined);
const mockSendLocalNotification = jest.fn().mockResolvedValue({ id: 'notif-1', scheduled: false });
const mockConnectAll = jest.fn().mockResolvedValue(undefined);
const mockInitSubAgentRegistry = jest.fn().mockResolvedValue(undefined);
const mockListActiveSubAgents = jest.fn().mockReturnValue([]);
const mockRepairTerminalAgentRunsMissingFinalResponses = jest.fn().mockResolvedValue([]);
const mockRecoverInterruptedForegroundModelExecutions = jest.fn().mockResolvedValue([]);
const mockMaintainForegroundModelExecutionRetention = jest.fn();
const mockMaintainTerminalExecutionRetention = jest.fn();
const mockHydrateCanvasSurfaces = jest.fn().mockResolvedValue(undefined);
const mockEmitAppEvent = jest.fn().mockResolvedValue(undefined);
const mockRunMemoryMigrationTick = jest.fn().mockResolvedValue(undefined);
const mockRunMemoryBackgroundFlush = jest.fn().mockResolvedValue(undefined);
const mockInitializeDurableRecoveryLifecycle = jest.fn();
const mockReconcileDurableRecoveryLifecycle = jest.fn().mockResolvedValue(undefined);
const mockFlushChatStorePersistenceNow = jest.fn().mockResolvedValue(undefined);
const mockRemoveRetiredMemoryArtifacts = jest.fn();
let mockSettingsHydrated = true;
let mockChatHydrated = true;
const mockSettingsHydrationListeners = new Set<() => void>();
const mockChatHydrationListeners = new Set<() => void>();
const originalRequestIdleCallback = (global as any).requestIdleCallback;
const { waitFor } = require('@testing-library/react-native');
const mockChatStoreState = {
  conversations: [] as any[],
  activeConversationId: 'active-conversation',
  createConversation: jest.fn(),
  getOrCreateCanonicalThread: jest.fn(),
  updateModeInConversation: jest.fn(),
  updatePersonaInConversation: jest.fn(),
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
jest.mock('../../src/services/integrations/registry', () => ({
  registerBuiltInServiceSkills: mockRegisterBuiltInServiceSkills,
}));
jest.mock('../../src/services/skills/manager', () => ({
  activateEnabledSkills: (...args: any[]) => mockActivateEnabledSkills(...args),
}));
jest.mock('../../src/services/scheduler/engine', () => ({
  setSchedulerExecutor: mockSetSchedulerExecutor,
  startScheduler: mockStartScheduler,
  stopScheduler: mockStopScheduler,
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
jest.mock('../../src/services/scheduler/runtimeReadiness', () => ({
  ensureSchedulerMaintenanceReady: jest.fn().mockResolvedValue(undefined),
  setSchedulerExecutionReadinessBarrier: jest.fn(),
}));
jest.mock('../../src/services/scheduler/jobExecutorPersistence', () => ({
  ...jest.requireActual('../../src/services/scheduler/jobExecutorPersistence'),
  checkpointScheduledAttemptConversation: jest.fn().mockResolvedValue(undefined),
  checkpointScheduledAttemptHooks: jest.fn().mockResolvedValue(undefined),
  checkpointScheduledAttemptCompletion: jest.fn().mockResolvedValue(undefined),
  checkpointScheduledExecutionResult: mockStartupScheduledExecutionCheckpoint,
  markScheduledAttemptEffectUnsafe: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/scheduler/scheduledProjectionRecovery', () => ({
  releaseStaleScheduledProjectionOwners: jest.fn().mockResolvedValue(0),
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
jest.mock('../../src/services/memory/retiredMemoryCleanup', () => ({
  removeRetiredMemoryArtifacts: (...args: any[]) => mockRemoveRetiredMemoryArtifacts(...args),
}));
jest.mock('../../src/services/executionJournal/durableRecoveryLifecycle', () => ({
  initializeDurableRecoveryLifecycle: (...args: any[]) =>
    mockInitializeDurableRecoveryLifecycle(...args),
  reconcileDurableRecoveryLifecycle: (...args: any[]) =>
    mockReconcileDurableRecoveryLifecycle(...args),
}));
jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: (...args: any[]) => mockFlushChatStorePersistenceNow(...args),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));
jest.mock('../../src/services/executionJournal/foregroundModelExecutionRecovery', () => ({
  recoverInterruptedForegroundModelExecutions: (...args: any[]) =>
    mockRecoverInterruptedForegroundModelExecutions(...args),
}));
jest.mock('../../src/services/executionJournal/foregroundModelExecutionRetention', () => ({
  maintainForegroundModelExecutionRetention: (...args: any[]) =>
    mockMaintainForegroundModelExecutionRetention(...args),
}));
jest.mock('../../src/services/executionJournal/terminalExecutionRetention', () => ({
  maintainTerminalExecutionRetention: (...args: any[]) =>
    mockMaintainTerminalExecutionRetention(...args),
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
    subscribe: () => () => undefined,
    persist: {
      hasHydrated: () => mockSettingsHydrated,
      onFinishHydration: (listener: () => void) => {
        mockSettingsHydrationListeners.add(listener);
        return () => mockSettingsHydrationListeners.delete(listener);
      },
    },
  },
}));
jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => mockChatStoreState,
    setState: (update: any) => {
      const next = typeof update === 'function' ? update(mockChatStoreState) : update;
      Object.assign(mockChatStoreState, next);
    },
    persist: {
      hasHydrated: () => mockChatHydrated,
      onFinishHydration: (listener: () => void) => {
        mockChatHydrationListeners.add(listener);
        return () => mockChatHydrationListeners.delete(listener);
      },
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
  mockRecoverInterruptedForegroundModelExecutions.mockResolvedValue([]);
  mockReconcileDurableRecoveryLifecycle.mockResolvedValue(undefined);
  mockFlushChatStorePersistenceNow.mockResolvedValue(undefined);
  mockEvaluateJobsOnce.mockResolvedValue(undefined);
  mockSyncSchedulerWakeNotifications.mockResolvedValue({ warnings: [] });
  mockRunMemoryMigrationTick.mockResolvedValue(undefined);
  mockRunMemoryBackgroundFlush.mockResolvedValue(undefined);
  mockSettingsHydrated = true;
  mockChatHydrated = true;
  mockSettingsHydrationListeners.clear();
  mockChatHydrationListeners.clear();
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
  mockRunOrchestrator.mockReset().mockImplementation(async (options, callbacks) => {
    const lastMessage = options.messages[options.messages.length - 1];
    callbacks.onAssistantMessage(
      `Result for ${lastMessage.content}`,
      [],
      undefined,
      completeFinalMetadata,
    );
    callbacks.onDone();
    return completedOrchestratorRun;
  });
});
afterAll(() => restoreRequestIdleCallback(originalRequestIdleCallback));
describe('initializeServices', () => {
  it('registers skills, sets executor, and starts scheduler', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    expect(mockRegisterBuiltInServiceSkills).toHaveBeenCalledTimes(1);
    expect(mockActivateEnabledSkills).toHaveBeenCalledTimes(1);
    expect(mockRemoveRetiredMemoryArtifacts).toHaveBeenCalledTimes(1);
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
    await waitFor(() =>
      expect(mockSyncSchedulerWakeNotifications).toHaveBeenCalledWith({ force: true }),
    );
  });
  it('reconciles scheduled jobs when the app returns to foreground', async () => {
    const { handleAppBackground, handleAppForeground } = require('../../src/services/startup');
    handleAppForeground();
    await waitFor(() =>
      expect(mockEvaluateJobsOnce).toHaveBeenCalledWith({ trigger: 'foreground-reconcile' }),
    );
    expect(mockSyncSchedulerWakeNotifications).toHaveBeenCalledWith({ force: true });
    handleAppBackground();
    expect(mockStopScheduler).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockRunMemoryMigrationTick).toHaveBeenCalledTimes(1));
    expect(mockRunMemoryBackgroundFlush).toHaveBeenCalledTimes(2);
  });
  it('initializes durable recovery ownership synchronously on startup', () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    expect(mockInitializeDurableRecoveryLifecycle).toHaveBeenCalledTimes(1);
  });
  it('repairs durable recovery candidates on foreground', async () => {
    const { handleAppForeground, initializeServices } = require('../../src/services/startup');
    initializeServices();
    await waitFor(() =>
      expect(mockRecoverInterruptedForegroundModelExecutions).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => {
      expect(mockMaintainForegroundModelExecutionRetention).toHaveBeenCalledTimes(1);
      expect(mockMaintainTerminalExecutionRetention).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    mockRecoverInterruptedForegroundModelExecutions.mockClear();
    mockChatStoreState.recoverInterruptedAgentRuns.mockClear();
    handleAppForeground();
    await waitFor(() =>
      expect(mockReconcileDurableRecoveryLifecycle).toHaveBeenCalledWith('foreground'),
    );
    await waitFor(() =>
      expect(mockRecoverInterruptedForegroundModelExecutions).toHaveBeenCalledTimes(1),
    );
    expect(mockChatStoreState.recoverInterruptedAgentRuns).toHaveBeenCalledTimes(1);
  });
  it('flushes durable memory work before waiting for migration', async () => {
    mockRunMemoryMigrationTick.mockImplementation(() => new Promise(() => undefined));
    const { handleAppForeground } = require('../../src/services/startup');
    handleAppForeground();
    await waitFor(() => expect(mockRunMemoryBackgroundFlush).toHaveBeenCalledTimes(1));
    expect(mockRunMemoryMigrationTick).toHaveBeenCalledTimes(1);
    expect(mockRunMemoryBackgroundFlush.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunMemoryMigrationTick.mock.invocationCallOrder[0],
    );
  });
  it('does not touch memory until both persisted stores finish hydrating', async () => {
    mockSettingsHydrated = false;
    mockChatHydrated = false;
    const { handleAppForeground } = require('../../src/services/startup');
    handleAppForeground();
    await Promise.resolve();
    expect(mockRunMemoryMigrationTick).not.toHaveBeenCalled();
    expect(mockRunMemoryBackgroundFlush).not.toHaveBeenCalled();
    mockSettingsHydrated = true;
    for (const listener of [...mockSettingsHydrationListeners]) listener();
    await Promise.resolve();
    expect(mockRunMemoryMigrationTick).not.toHaveBeenCalled();
    expect(mockRunMemoryBackgroundFlush).not.toHaveBeenCalled();
    mockChatHydrated = true;
    for (const listener of [...mockChatHydrationListeners]) listener();
    await waitFor(() => expect(mockRunMemoryMigrationTick).toHaveBeenCalledTimes(1));
    expect(mockRunMemoryBackgroundFlush).toHaveBeenCalledTimes(1);
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
    expect(mockRecoverInterruptedForegroundModelExecutions).toHaveBeenCalledTimes(1);
    expect(mockMaintainForegroundModelExecutionRetention).toHaveBeenCalledWith({
      now: expect.any(Number),
    });
    expect(mockMaintainTerminalExecutionRetention).toHaveBeenCalledWith({
      now: expect.any(Number),
      durabilityClass: 'external_durable_operation',
    });
    expect(mockReconcileDurableRecoveryLifecycle).toHaveBeenCalledWith('startup');
    expect(
      mockRecoverInterruptedForegroundModelExecutions.mock.invocationCallOrder[0],
    ).toBeLessThan(mockChatStoreState.recoverInterruptedAgentRuns.mock.invocationCallOrder[0]);
    expect(mockChatStoreState.recoverInterruptedAgentRuns.mock.invocationCallOrder[0]).toBeLessThan(
      mockRepairTerminalAgentRunsMissingFinalResponses.mock.invocationCallOrder[0],
    );
    expect(
      mockRepairTerminalAgentRunsMissingFinalResponses.mock.invocationCallOrder[0],
    ).toBeLessThan(mockFlushChatStorePersistenceNow.mock.invocationCallOrder[0]);
    expect(mockFlushChatStorePersistenceNow.mock.invocationCallOrder[0]).toBeLessThan(
      mockMaintainTerminalExecutionRetention.mock.invocationCallOrder[0],
    );
  });
  it('only initializes once (idempotent)', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    initializeServices();
    initializeServices();
    expect(mockRegisterBuiltInServiceSkills).toHaveBeenCalledTimes(1);
    expect(mockActivateEnabledSkills).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockStartScheduler).toHaveBeenCalledTimes(1));
  });
  it('retries retired memory cleanup without reinitializing services', async () => {
    const cleanupError = new Error('directory busy');
    mockRemoveRetiredMemoryArtifacts.mockImplementationOnce(() => {
      throw cleanupError;
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    initializeServices();
    expect(mockRemoveRetiredMemoryArtifacts).toHaveBeenCalledTimes(2);
    expect(mockRegisterBuiltInServiceSkills).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockStartScheduler).toHaveBeenCalledTimes(1));
    expect(warnSpy).toHaveBeenCalledWith('[startup] retired memory cleanup failed:', cleanupError);
    warnSpy.mockRestore();
  });
  it('passes an executor with execute function', () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    expect(executor).toHaveProperty('execute');
    expect(typeof executor.execute).toBe('function');
    expect(typeof executor.onFinalFailure).toBe('function');
  });
  it('executor runs scheduled jobs through the orchestrator and returns the result', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    const job = claimedSchedulerJob('Test Job', 'Summarize news');
    const result = await executor.execute(job);
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
    expect(mockSendLocalNotification).not.toHaveBeenCalled();
    await executor.onSuccess(job, result);
    expect(mockSendLocalNotification).toHaveBeenCalledWith({
      title: 'Test Job',
      body: 'Result for Summarize news',
      data: {
        screen: 'Chat',
        conversationId: 'conv-1',
        source: 'scheduled_task',
      },
    });
    expect(result).toEqual({
      output: 'Result for Summarize news',
      conversationId: 'conv-1',
    });
  });
  it('rejects and sends a failure notification for a blocked scheduled run', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage('Scheduled task reached a blocker.');
      callbacks.onAgentControlGraphStateChange?.({
        status: 'blocked',
        terminalReason: 'tool_batch_incomplete',
      });
      callbacks.onDone();
      return { terminalDisposition: 'blocked' as const };
    });
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    const job = claimedSchedulerJob('Blocked Job', 'Perform the action', {
      deliveryMode: 'both',
    });
    const error = await executor.execute(job).catch((executionError: unknown) => executionError);
    expect(error).toMatchObject({
      name: 'NonRetryableSchedulerExecutionError',
      message: expect.stringContaining('tool_batch_incomplete'),
    });
    expect(mockSendLocalNotification).not.toHaveBeenCalled();
    await executor.onFinalFailure(job, error);
    expect(mockSendLocalNotification).toHaveBeenCalledWith({
      title: 'Blocked Job',
      body: 'Error: Agent control graph was blocked: tool_batch_incomplete.',
      data: {
        screen: 'Chat',
        conversationId: 'conv-1',
        source: 'scheduled_task',
      },
    });
    mockSendLocalNotification.mockClear();
    await executor.onFinalFailure({ ...job, failureAlert: { enabled: false } }, error);
    expect(mockSendLocalNotification).not.toHaveBeenCalled();
  });
  it('persists tool messages generated during scheduled jobs', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage('Using a tool.', [
        { id: 'tc-1', name: 'read_file', arguments: '{}', status: 'pending' },
      ]);
      callbacks.onToolMessage('tc-1', 'tool result');
      callbacks.onAssistantMessage('done', [], undefined, completeFinalMetadata);
      callbacks.onDone();
      return completedOrchestratorRun;
    });
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute(claimedSchedulerJob('Tool Job', 'Run tool', { deliveryMode: 'both' }));
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
      callbacks.onAssistantMessage('done', [], undefined, completeFinalMetadata);
      callbacks.onDone();
      return completedOrchestratorRun;
    });
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute(
      claimedSchedulerJob('Gemini Tool Job', 'Continue tool loop', {
        deliveryMode: 'conversation',
      }),
    );
    expect(mockChatStoreState.updateMessageProviderReplay).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      providerReplay,
    );
  });
  it('marks JSON error tool messages as errors during scheduled jobs', async () => {
    const payload = JSON.stringify({ status: 'error', error: 'Missing surface' });
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage('Using a tool.', [
        { id: 'tc-2', name: 'read_file', arguments: '{}', status: 'pending' },
      ]);
      callbacks.onToolMessage('tc-2', payload);
      callbacks.onAssistantMessage('done', [], undefined, completeFinalMetadata);
      callbacks.onDone();
      return completedOrchestratorRun;
    });
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute(
      claimedSchedulerJob('Tool Error Job', 'Run failing tool', {
        deliveryMode: 'conversation',
      }),
    );
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
      callbacks.onAssistantMessage('done', [], undefined, completeFinalMetadata);
      callbacks.onDone();
      return completedOrchestratorRun;
    });
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await executor.execute(
      claimedSchedulerJob('Link Job', 'Prompt', { deliveryMode: 'conversation' }),
    );
    expect(mockChatStoreState.updateMessageEnrichedContent).toHaveBeenCalledWith(
      expect.any(String),
      'generated-user-message',
      'Prompt\n\n<link_context>Rich page content</link_context>',
    );
  });
});
