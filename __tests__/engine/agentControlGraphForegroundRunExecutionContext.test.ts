import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundConversationExecutionContext } from '../../src/engine/graph/foregroundRun/executionContext';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import { createForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';
import type { Conversation } from '../../src/types/conversation';
import type { LlmProviderConfig } from '../../src/types/provider';
import {
  __resetOnDeviceGuardsForTests,
  isMainInferenceActive,
} from '../../src/services/memory/onDeviceGuards';

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
  const flushChatState = jest.fn().mockResolvedValue(undefined);
  const beginModelExecution = jest.fn(async (input) => ({
    runId: `journal-${input.assistantMessageId}`,
    conversationId: input.conversationId,
    requestMessageId: input.requestMessageId,
    assistantMessageId: input.assistantMessageId,
    taskId: input.taskId ?? null,
    expectedStatus: 'running' as const,
    controlEpoch: 0,
    updatedAt: 10,
    checkpointId: `checkpoint-${input.assistantMessageId}`,
    checkpointStateDigest: 'a'.repeat(64),
  }));
  const completeModelExecution = jest.fn().mockResolvedValue(undefined);

  return {
    durability: {
      beginModelExecution,
      completeModelExecution,
      flushChatState,
    },
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
    __resetOnDeviceGuardsForTests();
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
    expect(context.durability.beginModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conversation.id,
        requestMessageId: 'user-1',
      }),
    );
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(
      context.durability.beginModelExecution.mock.invocationCallOrder[0],
    ).toBeLessThan(mockedRunOrchestrator.mock.invocationCallOrder[0]);
  });

  it('holds the inference lease through terminal lifecycle and releases it after completion', async () => {
    const conversation = createConversation({ mode: 'agentic' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });

    mockedResolveForegroundRunPreflight.mockResolvedValue({
      kind: 'ready',
      provider,
      providerWithApiKey: provider,
      model: provider.model,
      finalizationProviderContext: {
        provider,
        model: provider.model,
        systemPromptText: conversation.systemPrompt,
        conversationId: conversation.id,
      },
    });
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      expect(isMainInferenceActive()).toBe(true);
      callbacks.onDone();
      expect(isMainInferenceActive()).toBe(true);
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(isMainInferenceActive()).toBe(false);
  });

  it('releases the inference lease after an orchestrator exception', async () => {
    const conversation = createConversation({ mode: 'agentic' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue({
      kind: 'ready',
      provider,
      providerWithApiKey: provider,
      model: provider.model,
      finalizationProviderContext: {
        provider,
        model: provider.model,
        systemPromptText: conversation.systemPrompt,
        conversationId: conversation.id,
      },
    });
    mockedRunOrchestrator.mockImplementation(async () => {
      expect(isMainInferenceActive()).toBe(true);
      throw new Error('provider failed');
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(isMainInferenceActive()).toBe(false);
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('does not call the model when the journal-first boundary cannot be persisted', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue({
      kind: 'ready',
      provider,
      providerWithApiKey: provider,
      model: provider.model,
      finalizationProviderContext: {
        provider,
        model: provider.model,
        systemPromptText: conversation.systemPrompt,
        conversationId: conversation.id,
      },
    });
    context.durability.beginModelExecution.mockRejectedValueOnce(
      new Error('journal unavailable'),
    );

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(context.durability.flushChatState).toHaveBeenCalledTimes(2);
    expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
  });

  it('keeps callbacks and cleanup owned by each concurrent conversation', async () => {
    const firstConversation = createConversation({
      id: 'conversation-a',
      mode: 'chitchat',
      personaId: 'default',
    });
    const secondConversation = createConversation({
      id: 'conversation-b',
      mode: 'chitchat',
      personaId: 'default',
    });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation: firstConversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    context.helpers.getConversation = (conversationId: string) =>
      [firstConversation, secondConversation].find(
        (conversation) => conversation.id === conversationId,
      );
    context.helpers.getConversations = () => [firstConversation, secondConversation];

    const registry = createForegroundRequestRegistry();
    context.requests = {
      abortForegroundRequestForConversation: (conversationId, reason) =>
        registry.abortForConversation(conversationId, reason),
      clearForegroundRequest: (conversationId, requestId, controller) =>
        registry.clear({ conversationId, requestId, controller }),
      isCurrentForegroundRequest: (conversationId, requestId, controller) =>
        registry.isCurrent({ conversationId, requestId, controller }),
      registerForegroundRequest: (requestId, conversationId, controller) =>
        registry.register({ conversationId, requestId, controller }),
      setStreamingMessageId: (conversationId, requestId, controller, messageId) =>
        registry.setStreamingMessageId({ conversationId, requestId, controller }, messageId),
    };

    mockedResolveForegroundRunPreflight.mockImplementation(async ({ conversation }) => ({
      kind: 'ready',
      provider,
      providerWithApiKey: provider,
      model: provider.model,
      finalizationProviderContext: {
        provider,
        model: provider.model,
        systemPromptText: conversation?.systemPrompt ?? '',
        conversationId: conversation?.id ?? '',
      },
    }));

    const callbacksByConversation = new Map<string, Parameters<typeof runOrchestrator>[1]>();
    const releaseByConversation = new Map<string, () => void>();
    mockedRunOrchestrator.mockImplementation(
      (options, callbacks) =>
        new Promise<void>((resolve) => {
          callbacksByConversation.set(options.conversationId, callbacks);
          releaseByConversation.set(options.conversationId, resolve);
        }),
    );

    const firstRun = executeForegroundConversationRun({
      context,
      conversationId: firstConversation.id,
    });
    const secondRun = executeForegroundConversationRun({
      context,
      conversationId: secondConversation.id,
    });
    for (let attempt = 0; attempt < 10 && callbacksByConversation.size < 2; attempt += 1) {
      await Promise.resolve();
    }

    expect(callbacksByConversation.size).toBe(2);
    expect(isMainInferenceActive()).toBe(true);
    callbacksByConversation
      .get(firstConversation.id)
      ?.onUserMessageEnriched?.('user-a', 'enriched-a');
    callbacksByConversation
      .get(secondConversation.id)
      ?.onUserMessageEnriched?.('user-b', 'enriched-b');
    expect(context.store.updateMessageEnrichedContent).toHaveBeenCalledWith(
      firstConversation.id,
      'user-a',
      'enriched-a',
    );
    expect(context.store.updateMessageEnrichedContent).toHaveBeenCalledWith(
      secondConversation.id,
      'user-b',
      'enriched-b',
    );

    callbacksByConversation.get(firstConversation.id)?.onDone();
    releaseByConversation.get(firstConversation.id)?.();
    await firstRun;

    expect(registry.hasConversation(firstConversation.id)).toBe(false);
    expect(registry.hasConversation(secondConversation.id)).toBe(true);
    expect(isMainInferenceActive()).toBe(true);
    callbacksByConversation
      .get(secondConversation.id)
      ?.onUserMessageEnriched?.('user-b', 'still-current');
    expect(context.store.updateMessageEnrichedContent).toHaveBeenCalledWith(
      secondConversation.id,
      'user-b',
      'still-current',
    );

    callbacksByConversation.get(secondConversation.id)?.onDone();
    releaseByConversation.get(secondConversation.id)?.();
    await secondRun;
    expect(registry.size).toBe(0);
    expect(isMainInferenceActive()).toBe(false);
  });
});
