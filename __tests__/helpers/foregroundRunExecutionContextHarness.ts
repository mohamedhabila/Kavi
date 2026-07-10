import type { Conversation } from '../../src/types/conversation';
import type { LlmProviderConfig } from '../../src/types/provider';

export function createConversation(overrides: Partial<Conversation> = {}): Conversation {
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

export function createProvider(id: string, model: string): LlmProviderConfig {
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

export function createExecutionContext(params: {
  conversation: Conversation;
  providers: LlmProviderConfig[];
  recordConversationTurnMemory: jest.Mock;
  ensureCanonicalConversation: jest.Mock;
}) {
  let idSequence = 0;
  const projectionOwners = new Map<string, { runId: string }>();
  const projectionWaiters = new Map<string, Set<() => void>>();
  const noOp = jest.fn();
  const flushChatState = jest.fn().mockResolvedValue(undefined);
  const createModelExecution = jest.fn(async (input) => ({
    runId: `journal-${input.assistantMessageId}`,
    conversationId: input.conversationId,
    requestMessageId: input.requestMessageId,
    assistantMessageId: input.assistantMessageId,
    taskId: input.taskId ?? null,
    createdAt: 10,
    expectedStatus: 'queued' as const,
    controlEpoch: 0,
    updatedAt: 10,
    checkpointId: `created-${input.assistantMessageId}`,
    checkpointStateDigest: 'a'.repeat(64),
  }));
  const activateModelExecution = jest.fn(async ({ lease }) => ({
    ...lease,
    expectedStatus: 'running' as const,
    updatedAt: 11,
    checkpointId: `before-${lease.assistantMessageId}`,
  }));
  const completeModelExecution = jest.fn().mockResolvedValue(undefined);

  return {
    durability: {
      activateModelExecution,
      claimModelProjection: jest.fn(({ conversationId, owner }) => {
        const current = projectionOwners.get(conversationId);
        if (current && current.runId !== owner.runId) return 'owner_conflict' as const;
        projectionOwners.set(conversationId, owner);
        return 'claimed' as const;
      }),
      completeModelExecution,
      createModelExecution,
      flushChatState,
      ownsModelProjection: jest.fn((conversationId, owner) =>
        projectionOwners.get(conversationId)?.runId === owner.runId
      ),
      relinquishModelExecutionProcessOwnership: jest.fn(),
      releaseModelProjection: jest.fn(({ conversationId, owner }) => {
        if (projectionOwners.get(conversationId)?.runId !== owner.runId) {
          return 'owner_changed' as const;
        }
        projectionOwners.delete(conversationId);
        for (const resolve of projectionWaiters.get(conversationId) ?? []) resolve();
        projectionWaiters.delete(conversationId);
        return 'released' as const;
      }),
      waitForRecoveryReadiness: jest.fn().mockResolvedValue(undefined),
      waitForProjectionAvailability: jest.fn(async ({ conversationId, signal }) => {
        if (!projectionOwners.has(conversationId)) return;
        await new Promise<void>((resolve, reject) => {
          const waiters = projectionWaiters.get(conversationId) ?? new Set();
          waiters.add(resolve);
          projectionWaiters.set(conversationId, waiters);
          signal.addEventListener(
            'abort',
            () => reject(new Error('foreground_model_projection_wait_cancelled')),
            { once: true },
          );
        });
      }),
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
