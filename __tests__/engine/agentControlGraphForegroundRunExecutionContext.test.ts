import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundConversationExecutionContext } from '../../src/engine/graph/foregroundRun/executionContext';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import type { Conversation } from '../../src/types/conversation';
import type { LlmProviderConfig } from '../../src/types/provider';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
}));

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'target-conversation',
    title: 'Target conversation',
    messages: [
      {
        id: 'user-1',
        role: 'user',
        content: 'Continue this conversation.',
        timestamp: 1,
      },
    ],
    providerId: 'target-provider',
    systemPrompt: 'Target system prompt',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createProvider(id: string, model: string): LlmProviderConfig {
  return {
    id,
    name: id,
    enabled: true,
    kind: 'remote',
    baseUrl: `https://${id}.example.com`,
    apiKey: `${id}-key`,
    model,
  };
}

function createExecutionContext(params: {
  conversation: Conversation;
  providers: LlmProviderConfig[];
  recordConversationTurnMemory: jest.Mock;
  ensureCanonicalConversation: jest.Mock;
}) {
  let idSequence = 0;
  const noOp = jest.fn();

  return {
    helpers: {
      appendConversationLog: noOp,
      clearPendingRunState: noOp,
      clearTrackedRunCancellation: noOp,
      createId: () => `generated-${++idSequence}`,
      ensureAgentRunFinalResponse: jest.fn(),
      ensureCanonicalConversation: params.ensureCanonicalConversation,
      getConversation: (conversationId: string) =>
        conversationId === params.conversation.id ? params.conversation : undefined,
      getConversations: () => [params.conversation],
      getResumeAgentRun: () => null,
      recordConversationTurnMemory: params.recordConversationTurnMemory,
      requestPersistenceCheckpoint: noOp,
      setChatError: noOp,
    },
    refs: {
      forceNextScrollRef: { current: false },
      pendingAgentRunAsyncResumesRef: { current: new Map() },
      pendingAgentRunFinalizationsRef: { current: new Map() },
      pendingAgentRunTerminalReviewsRef: { current: new Map() },
      runInvocationSequenceRef: { current: 0 },
      shouldAutoFollowRef: { current: true },
      streamingDraftsRef: { current: {} },
    },
    requests: {
      abortForegroundRequestForConversation: jest.fn(() => false),
      clearForegroundRequest: jest.fn(() => true),
      isCurrentForegroundRequest: jest.fn(() => true),
      registerForegroundRequest: noOp,
      setStreamingMessageId: noOp,
    },
    state: {
      activeModel: 'stale-model',
      activeProviderId: 'stale-provider',
      chatNoApiKeyMessage: 'Missing API key',
      chatNoModelMessage: 'Missing model',
      chatNoProviderMessage: 'Missing provider',
      defaultConversationMode: 'agentic' as const,
      exportDialogTitle: 'Export',
      linkUnderstandingEnabled: true,
      maxLinks: 4,
      mediaUnderstandingEnabled: true,
      providers: params.providers,
      streamStoreCheckpointIntervalMs: 100,
      streamUiDraftPublishIntervalMs: 16,
      systemPrompt: 'Global system prompt',
      thinkingLevel: 'medium' as const,
      toolResultPersistenceCheckpointDelayMs: 50,
    },
    store: {
      addMessage: noOp,
      addToolCall: noOp,
      appendAgentRunCheckpoint: noOp,
      applyConversationCompaction: noOp,
      completeAgentRun: noOp,
      setAgentRunPhase: noOp,
      startAgentRun: jest.fn(() => 'run-1'),
      updateAgentRunAsyncWork: noOp,
      updateAgentRunControlGraph: noOp,
      updateAgentRunPlan: noOp,
      updateAgentRunSummary: noOp,
      updateMessage: noOp,
      updateMessageAssistantMetadata: noOp,
      updateMessageEffect: noOp,
      updateMessageEnrichedContent: noOp,
      updateMessageProviderReplay: noOp,
      updateMessageReasoning: noOp,
      updateToolCallStatus: noOp,
    },
    streaming: {
      clearStreamingDraft: noOp,
      mergeStreamingDraft: noOp,
      updateStreamingDraft: noOp,
    },
  };
}

describe('foreground run target-conversation execution context', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('uses the configured default mode when the target conversation has no mode', () => {
    expect(
      resolveForegroundConversationExecutionContext({
        conversation: createConversation({ mode: undefined, personaId: 'reviewer' }),
        defaultConversationMode: 'chitchat',
      }),
    ).toEqual({
      mode: 'chitchat',
      personaId: 'reviewer',
    });
  });

  it('resolves agentic targets to the super-agent persona', () => {
    expect(
      resolveForegroundConversationExecutionContext({
        conversation: createConversation({ mode: 'agentic', personaId: 'stale-persona' }),
        defaultConversationMode: 'chitchat',
      }),
    ).toEqual({
      mode: 'agentic',
      personaId: 'super-agent',
    });
  });

  it('preserves a non-super-agent persona for chitchat targets', () => {
    expect(
      resolveForegroundConversationExecutionContext({
        conversation: createConversation({ mode: 'chitchat', personaId: 'reviewer' }),
        defaultConversationMode: 'agentic',
      }),
    ).toEqual({
      mode: 'chitchat',
      personaId: 'reviewer',
    });
  });

  it('drops a stale super-agent persona when the target is chitchat', () => {
    expect(
      resolveForegroundConversationExecutionContext({
        conversation: createConversation({ mode: 'chitchat', personaId: 'super-agent' }),
        defaultConversationMode: 'agentic',
      }),
    ).toEqual({
      mode: 'chitchat',
      personaId: 'default',
    });
  });

  it('uses one target snapshot for orchestration, commands, and terminal memory provenance', async () => {
    const conversation = createConversation({ mode: 'chitchat', personaId: 'reviewer' });
    const staleProvider = createProvider('stale-provider', 'stale-model');
    const targetProvider = createProvider('target-provider', 'target-model');
    const finalizationProvider = { ...targetProvider, apiKey: 'hydrated-key' };
    const ensureCanonicalConversation = jest.fn(() => 'new-conversation');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [staleProvider, targetProvider],
      ensureCanonicalConversation,
      recordConversationTurnMemory,
    });

    mockedResolveForegroundRunPreflight.mockResolvedValue({
      kind: 'ready',
      provider: targetProvider,
      providerWithApiKey: finalizationProvider,
      model: 'target-model',
      finalizationProviderContext: {
        provider: finalizationProvider,
        model: 'target-model',
        systemPromptText: conversation.systemPrompt,
        conversationId: conversation.id,
      },
    });
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onCommandResult?.({ action: 'new_conversation' });
      callbacks.onDone();
    });

    await executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });

    expect(mockedRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conversation.id,
        personaId: 'reviewer',
      }),
      expect.any(Object),
    );
    expect(ensureCanonicalConversation).toHaveBeenCalledWith({
      mode: 'chitchat',
      personaId: 'reviewer',
      reportMissingProvider: true,
    });
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        id: 'target-provider',
        model: 'target-model',
      }),
      expect.objectContaining({
        memoryConversationId: conversation.id,
      }),
    );
  });
});
