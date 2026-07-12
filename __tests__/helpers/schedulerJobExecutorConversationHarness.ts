import type { CronJob } from '../../src/services/cron/types';
import type { Conversation } from '../../src/types/conversation';
import type { Message, ToolCall } from '../../src/types/message';

export const mockRunOrchestrator = jest.fn();
export const mockFlushChatStorePersistenceNow = jest.fn().mockResolvedValue(undefined);
export const mockCheckpointScheduledAttemptConversation = jest.fn().mockResolvedValue(undefined);
export const mockCheckpointScheduledAttemptCompletion = jest.fn().mockResolvedValue(undefined);
let mockRunningCompletion: { output: string } | undefined;
let mockNextId = 0;

const mockProvider = {
  id: 'openai',
  name: 'OpenAI',
  model: 'gpt-5.4',
  enabled: true,
  apiKey: 'sk-test',
};

export function mockConversation(conversationId: string): Conversation {
  return {
    id: conversationId,
    title: 'Scheduled task',
    messages: [],
    providerId: mockProvider.id,
    modelOverride: mockProvider.model,
    systemPrompt: 'You are helpful.',
    createdAt: 1,
    updatedAt: 1,
    personaId: 'super-agent',
    mode: 'agentic',
  };
}

export function findMockConversation(conversationId: string): Conversation {
  const conversation = mockChatState.conversations.find(
    (candidate: Conversation) => candidate.id === conversationId,
  );
  if (!conversation) throw new Error(`Missing mock conversation ${conversationId}`);
  return conversation;
}

function updateMockMessage(
  conversationId: string,
  messageId: string,
  update: (message: Message) => void,
): void {
  const message = findMockConversation(conversationId).messages.find(
    (candidate) => candidate.id === messageId,
  );
  if (!message) throw new Error(`Missing mock message ${messageId}`);
  update(message);
}

export const mockChatState = {
  conversations: [] as Conversation[],
  activeConversationId: null as string | null,
  createConversation: jest.fn(
    (
      _providerId: string,
      _systemPrompt: string,
      _model: string,
      _options: Record<string, unknown>,
    ) => {
      const conversation = mockConversation('scheduled-conversation');
      mockChatState.conversations.push(conversation);
      return conversation.id;
    },
  ),
  getOrCreateCanonicalThread: jest.fn(),
  updateModeInConversation: jest.fn((conversationId: string, mode: Conversation['mode']) => {
    findMockConversation(conversationId).mode = mode;
  }),
  updatePersonaInConversation: jest.fn((conversationId: string, personaId: string) => {
    findMockConversation(conversationId).personaId = personaId;
  }),
  updateModelInConversation: jest.fn(
    (conversationId: string, providerId: string, model: string) => {
      const conversation = findMockConversation(conversationId);
      conversation.providerId = providerId;
      conversation.modelOverride = model;
    },
  ),
  addMessage: jest.fn(
    (
      conversationId: string,
      message: Omit<Message, 'id' | 'timestamp'> & { id?: string; timestamp?: number },
    ) => {
      findMockConversation(conversationId).messages.push({
        ...message,
        id: message.id ?? `store-message-${++mockNextId}`,
        timestamp: message.timestamp ?? Date.now(),
      });
    },
  ),
  updateMessage: jest.fn((conversationId: string, messageId: string, content: string) => {
    updateMockMessage(conversationId, messageId, (message) => {
      message.content = content;
    });
  }),
  updateMessageEnrichedContent: jest.fn(),
  updateMessageReasoning: jest.fn(
    (conversationId: string, messageId: string, reasoning: string) => {
      updateMockMessage(conversationId, messageId, (message) => {
        message.reasoning = reasoning;
      });
    },
  ),
  updateMessageProviderReplay: jest.fn(
    (conversationId: string, messageId: string, providerReplay: Message['providerReplay']) => {
      updateMockMessage(conversationId, messageId, (message) => {
        message.providerReplay = providerReplay;
      });
    },
  ),
  updateMessageAssistantMetadata: jest.fn(
    (conversationId: string, messageId: string, metadata: Message['assistantMetadata']) => {
      updateMockMessage(conversationId, messageId, (message) => {
        message.assistantMetadata = metadata;
      });
    },
  ),
  updateMessageEffect: jest.fn(),
  addToolCall: jest.fn((conversationId: string, messageId: string, toolCall: ToolCall) => {
    updateMockMessage(conversationId, messageId, (message) => {
      message.toolCalls = [...(message.toolCalls ?? []), toolCall];
    });
  }),
  updateToolCallStatus: jest.fn(
    (
      conversationId: string,
      messageId: string,
      toolCallId: string,
      status: ToolCall['status'],
      payload?: Pick<ToolCall, 'result' | 'error'>,
    ) => {
      updateMockMessage(conversationId, messageId, (message) => {
        const toolCall = message.toolCalls?.find((candidate) => candidate.id === toolCallId);
        if (!toolCall) throw new Error(`Missing mock tool call ${toolCallId}`);
        Object.assign(toolCall, payload, { status });
      });
    },
  ),
  applyConversationCompaction: jest.fn(),
};

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: async (...args: unknown[]) =>
    (await mockRunOrchestrator(...args)) ?? { terminalDisposition: 'final_candidate' },
}));
jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: (...args: unknown[]) => mockFlushChatStorePersistenceNow(...args),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));
jest.mock('../../src/services/scheduler/jobExecutorPersistence', () => ({
  ...jest.requireActual('../../src/services/scheduler/jobExecutorPersistence'),
  checkpointScheduledAttemptConversation: (...args: unknown[]) =>
    mockCheckpointScheduledAttemptConversation(...args),
  checkpointScheduledAttemptHooks: jest.fn().mockResolvedValue(undefined),
  checkpointScheduledAttemptCompletion: (...args: unknown[]) =>
    mockCheckpointScheduledAttemptCompletion(...args),
  checkpointScheduledExecutionResult: async (params: {
    job: CronJob;
    output: string;
    conversationId: string;
    warnings?: string[];
    pendingVerifiedProcedureCommit?: unknown;
  }) => {
    const warnings = params.warnings ?? [];
    const result = {
      output: params.output,
      conversationId: params.conversationId,
      ...(warnings.length > 0 ? { warnings, conversationDurable: false } : {}),
      ...(params.pendingVerifiedProcedureCommit
        ? { pendingVerifiedProcedureCommit: params.pendingVerifiedProcedureCommit }
        : {}),
    };
    await mockCheckpointScheduledAttemptCompletion(params.job, result);
    return result;
  },
  markScheduledAttemptEffectUnsafe: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: {
    getState: () => ({
      getJob: () =>
        mockRunningCompletion ? { runningCompletion: mockRunningCompletion } : undefined,
    }),
  },
}));
jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => mockChatState,
    setState: (update: any) => {
      const next = typeof update === 'function' ? update(mockChatState) : update;
      Object.assign(mockChatState, next);
    },
  },
}));
jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      providers: [mockProvider],
      activeProviderId: mockProvider.id,
      activeModel: mockProvider.model,
      systemPrompt: 'You are helpful.',
      thinkingLevel: 'medium',
      linkUnderstandingEnabled: true,
      mediaUnderstandingEnabled: true,
      maxLinks: 3,
    }),
  },
}));
jest.mock('../../src/services/llm/support/providerSupport', () => ({
  providerRequiresApiKey: () => true,
  resolveConversationModel: () => mockProvider.model,
  resolveEnabledProvider: () => mockProvider,
  resolveProviderApiKey: () => Promise.resolve(mockProvider.apiKey),
}));
jest.mock('../../src/services/memory/workingBlocks', () => ({
  editWorkingBlock: jest.fn(),
}));
jest.mock('../../src/utils/id', () => ({
  generateId: () => `generated-message-${++mockNextId}`,
}));

export { executeScheduledJob } from '../../src/services/scheduler/jobExecutor';
export {
  abortAllScheduledJobExecutions,
  getScheduledExecutionLifecycleEpoch,
} from '../../src/services/scheduler/executionLifecycle';
import {
  abortAllScheduledJobExecutions,
  getScheduledExecutionLifecycleEpoch,
} from '../../src/services/scheduler/executionLifecycle';
import { executeScheduledJob } from '../../src/services/scheduler/jobExecutor';
import { resetScheduledProjectionReleaseRecoveryForTests } from '../../src/services/scheduler/jobExecutorProjection';
import {
  beginModelProjectionIntent,
  resetModelProjectionIntentCoordinatorForTests,
} from '../../src/store/modelProjectionIntentCoordinator';

export { beginModelProjectionIntent };

export function scheduledJob(): CronJob {
  return {
    id: 'job-1',
    definitionRevision: 1,
    name: 'Weather check',
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'isolated',
    wakeMode: 'new',
    payload: { prompt: 'Check the weather', mode: 'agentic' },
    runningAttemptId: 'attempt-job-1',
    runningStartedAtMs: 1,
    runningDefinitionRevision: 1,
    runningAttemptNumber: 1,
    runningEffectRisk: 'safe',
    runningOccurrenceId: 'occurrence-job-1',
  };
}

export function executeJob(job: CronJob = scheduledJob()) {
  return executeScheduledJob(job, {
    lifecycleEpoch: getScheduledExecutionLifecycleEpoch(),
  });
}

export function resetSchedulerJobExecutorConversationHarness(): void {
  jest.clearAllMocks();
  mockNextId = 0;
  mockRunningCompletion = undefined;
  mockChatState.conversations = [];
  mockChatState.activeConversationId = null;
  mockCheckpointScheduledAttemptCompletion.mockImplementation(
    (_job: CronJob, result: { output: string }) => {
      mockRunningCompletion = { output: result.output };
      return Promise.resolve();
    },
  );
  mockFlushChatStorePersistenceNow.mockResolvedValue(undefined);
  resetModelProjectionIntentCoordinatorForTests();
  resetScheduledProjectionReleaseRecoveryForTests();
  expect(abortAllScheduledJobExecutions()).toBe(0);
}

export function cleanupSchedulerJobExecutorConversationHarness(): void {
  resetScheduledProjectionReleaseRecoveryForTests();
}
