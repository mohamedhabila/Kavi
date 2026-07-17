import { claimedSchedulerJob } from '../helpers/schedulerClaimedJobFixture';
import { restoreRequestIdleCallback } from '../helpers/idleCallbackFixture';
import {
  completeFinalMetadata,
  completedOrchestratorRun,
  emitWorkerSurfaceFollowupSequence,
  mockStartupScheduledExecutionCheckpoint,
  startupTestProvider as mockProvider,
  toolMessageOutcome,
} from '../helpers/startupSchedulerRuntimeFixtures';

jest.mock('../../src/services/memory/retiredMemoryCleanup', () => ({
  removeRetiredMemoryArtifacts: jest.fn(),
}));

const mockRegisterBuiltInServiceSkills = jest.fn();
const mockActivateEnabledSkills = jest.fn();
const mockSetSchedulerExecutor = jest.fn();

const mockStartScheduler = jest.fn().mockResolvedValue(undefined);
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
const mockFlushChatStorePersistenceNow = jest.fn().mockResolvedValue(undefined);
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
jest.mock('../../src/services/executionJournal/durableRecoveryLifecycle', () => ({
  initializeDurableRecoveryLifecycle: jest.fn(),
  reconcileDurableRecoveryLifecycle: jest.fn().mockResolvedValue(undefined),
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
      hasHydrated: () => true,
      onFinishHydration: () => () => {},
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
      hasHydrated: () => true,
      onFinishHydration: () => () => {},
    },
  },
}));
jest.mock('../../src/utils/id', () => {
  let nextId = 1;
  return { generateId: jest.fn(() => `generated-id-${nextId++}`) };
});
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
  mockEvaluateJobsOnce.mockResolvedValue(undefined);
  mockSyncSchedulerWakeNotifications.mockResolvedValue({ warnings: [] });
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
  it('orders a successful post-worker confirmation after the surfaced output', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFlushChatStorePersistenceNow
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk unavailable'));
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      emitWorkerSurfaceFollowupSequence(callbacks);
      return completedOrchestratorRun;
    });
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await expect(
      executor.execute(
        claimedSchedulerJob('Surface Worker Job', 'Use the worker answer', {
          deliveryMode: 'conversation',
        }),
      ),
    ).resolves.toEqual({
      output: 'Final action completed.',
      conversationId: 'conv-1',
      conversationDurable: false,
      warnings: ['Conversation persistence failed: disk unavailable'],
    });
    const visibleAssistantSegments = mockChatStoreState.conversations[0].messages.filter(
      (message: any) => message.role === 'assistant' && message.content.trim(),
    );
    expect(visibleAssistantSegments).toEqual([
      expect.objectContaining({
        content: 'Worker-authored final answer',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'incomplete',
        }),
      }),
      expect.objectContaining({
        content: 'Continuing with another action.',
      }),
      expect.objectContaining({
        content: 'Final action completed.',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
        }),
      }),
    ]);
    expect(mockChatStoreState.updateMessage).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'Final action completed.',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[scheduler] Scheduled result persistence failed:',
      expect.objectContaining({ message: 'disk unavailable' }),
    );
    warnSpy.mockRestore();
  });
  it('preserves a graph blocker after surfacing a worker result', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onToolCallComplete?.({
        id: 'tc-surface-blocked',
        name: 'sessions_surface_output',
        arguments: '{"sessionId":"worker-1"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'surfaced',
          sessionId: 'worker-1',
          output: 'Worker completed its bounded research.',
        }),
      });
      callbacks.onAgentControlGraphStateChange?.({
        status: 'blocked',
        terminalReason: 'missing_required_side_effect',
      });
      callbacks.onAssistantMessage?.(
        'The required downstream action was not completed.',
        [],
        undefined,
        {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        },
      );
      callbacks.onToolMessage?.(
        toolMessageOutcome('tc-surface-blocked', 'completed', 'tool result'),
      );
      callbacks.onDone?.();
      return { terminalDisposition: 'blocked' as const };
    });
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await expect(
      executor.execute(
        claimedSchedulerJob('Blocked Surface Job', 'Research and act', {
          deliveryMode: 'conversation',
        }),
      ),
    ).rejects.toMatchObject({
      name: 'NonRetryableSchedulerExecutionError',
      message: expect.stringContaining('missing_required_side_effect'),
    });
    const visibleAssistantSegments = mockChatStoreState.conversations[0].messages.filter(
      (message: any) => message.role === 'assistant' && message.content.trim(),
    );
    expect(visibleAssistantSegments).toEqual([
      expect.objectContaining({
        content: 'Worker completed its bounded research.',
        assistantMetadata: expect.objectContaining({
          finishReason: 'surfaced_worker_output_pending',
        }),
      }),
      expect.objectContaining({
        content: 'The required downstream action was not completed.',
        isError: true,
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        }),
      }),
    ]);
    expect(mockChatStoreState.updateMessage).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'The required downstream action was not completed.',
    );
  });
  it('defers failure notifications until the scheduler marks the attempt final', async () => {
    mockRunOrchestrator.mockRejectedValueOnce(new Error('boom'));
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    const job = claimedSchedulerJob('Broken Job', 'Fail', { deliveryMode: 'both' });
    const error = await executor.execute(job).catch((executionError: unknown) => executionError);
    expect(error).toMatchObject({ message: 'boom' });
    expect(mockSendLocalNotification).not.toHaveBeenCalled();
    await executor.onFinalFailure(job, error);
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
  it('keeps replay-safe tool activity retryable after a provider disconnect', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFlushChatStorePersistenceNow
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk unavailable'));
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onToolCallComplete?.({
        id: 'tc-effect',
        name: 'sessions_surface_output',
        arguments: '{}',
        status: 'completed',
        result: JSON.stringify({
          status: 'surfaced',
          sessionId: 'worker-1',
          output: 'Worker output before disconnect.',
        }),
      });
      callbacks.onToolMessage?.(toolMessageOutcome('tc-effect', 'completed', 'tool result'));
      throw new Error('provider disconnected after tool dispatch');
    });
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const executor = mockSetSchedulerExecutor.mock.calls[0][0];
    await expect(
      executor.execute(
        claimedSchedulerJob('Effectful Failure', 'Create the event', {
          deliveryMode: 'conversation',
        }),
      ),
    ).rejects.toMatchObject({
      name: 'SchedulerExecutionError',
      message: 'provider disconnected after tool dispatch',
    });
    const visibleAssistantSegments = mockChatStoreState.conversations[0].messages.filter(
      (message: any) => message.role === 'assistant' && message.content.trim(),
    );
    expect(visibleAssistantSegments.map((message: any) => message.content)).toEqual([
      'Worker output before disconnect.',
      'Error: provider disconnected after tool dispatch',
    ]);
    expect(visibleAssistantSegments.at(-1)?.assistantMetadata).toMatchObject({
      completionStatus: 'incomplete',
      finishReason: 'response_failed',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[scheduler] Scheduled failure persistence failed:',
      expect.objectContaining({ message: 'disk unavailable' }),
    );
    warnSpy.mockRestore();
  });
  it('executor reuses the active conversation and pins the scheduled mode', async () => {
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
    await executor.execute(
      claimedSchedulerJob('Continue Job', 'Continue existing thread', {
        mode: 'chitchat',
        sessionTarget: 'main',
        wakeMode: 'continue',
      }),
    );
    expect(mockChatStoreState.createConversation).not.toHaveBeenCalled();
    expect(mockChatStoreState.updateModeInConversation).toHaveBeenCalledWith(
      'active-conversation',
      'chitchat',
    );
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
    await executor.execute(
      claimedSchedulerJob('Main Job', 'Use the main thread', {
        sessionTarget: 'main',
      }),
    );
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
    await expect(executor.execute({ name: 'Empty', payload: {} })).rejects.toMatchObject({
      name: 'NonRetryableSchedulerExecutionError',
      message: expect.stringContaining('missing a prompt'),
    });
  });
  it('defers non-critical startup work until idle time', async () => {
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
    await waitFor(() => expect(mockStartScheduler).toHaveBeenCalledTimes(1));
    expect(mockHydrateCanvasSurfaces).not.toHaveBeenCalled();
    expect(mockInitializeNotifications).not.toHaveBeenCalled();
    expect(mockRegisterBackgroundFetch).not.toHaveBeenCalled();
    expect(mockLoadHooksFromDirectory).toHaveBeenCalledTimes(1);
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
  it('keeps hook readiness failed closed and retries registration', async () => {
    const loadError = new Error('hook directory unavailable');
    mockLoadHooksFromDirectory.mockRejectedValueOnce(loadError).mockResolvedValueOnce(undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { handleAppForeground, initializeServices } = require('../../src/services/startup');
    initializeServices();
    await waitFor(() => expect(mockLoadHooksFromDirectory).toHaveBeenCalledTimes(1));
    expect(mockStartScheduler).not.toHaveBeenCalled();
    handleAppForeground();
    await waitFor(() => expect(mockStartScheduler).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockLoadHooksFromDirectory).toHaveBeenCalledTimes(2));
    expect(mockEmitAppEvent).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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
  it('runs hook work under a child of the scheduled execution signal', async () => {
    const { initializeServices } = require('../../src/services/startup');
    initializeServices();
    const hookCallback = mockLoadHooksFromDirectory.mock.calls[0][0];
    const executionSignal = new AbortController();
    mockRunOrchestrator.mockImplementationOnce(async (options) => {
      expect(options).toMatchObject({ taskId: 'attempt-1', agentRunId: 'attempt-1' });
      executionSignal.abort(new Error('background'));
      expect(options.signal.signal.aborted).toBe(true);
      return { terminalDisposition: 'cancelled' as const };
    });
    await hookCallback('test prompt', { agentRunId: 'attempt-1', executionSignal });
  });
});
