import type { Conversation, ModelProjectionOwner } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';
import type { LlmProviderConfig } from '../../src/types/provider';
import type { ForegroundRunPreflightResult } from '../../src/engine/graph/foregroundRun/preflight';
import {
  appendAgentRunCheckpointInConversation,
  completeAgentRunInConversation,
  setAgentRunPhaseInConversation,
  startAgentRunInConversation,
  updateAgentRunSummaryInConversation,
} from '../../src/store/agentRuns/lifecycle';
import {
  updateAgentRunAsyncWorkInConversation,
  updateAgentRunControlGraphInConversation,
} from '../../src/store/agentRuns/graph';
import { useChatStore } from '../../src/store/useChatStore';
import { applyMobileControllerOutcomeInConversation } from '../../src/store/agentRuns/mobileControllerOutcome';

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

export function createReadyPreflightResult(params: {
  conversation: Conversation;
  provider: LlmProviderConfig;
  providerWithApiKey?: LlmProviderConfig;
  model?: string;
}): Extract<ForegroundRunPreflightResult, { kind: 'ready' }> {
  const model = params.model ?? params.provider.model;
  const providerWithApiKey = params.providerWithApiKey ?? params.provider;

  return {
    kind: 'ready',
    provider: params.provider,
    providerWithApiKey,
    model,
  };
}

export function createExecutionContext(params: {
  conversation: Conversation;
  resetConversationContext?: jest.Mock;
  providers: LlmProviderConfig[];
  recordConversationTurnMemory: jest.Mock;
  ensureConversation: jest.Mock;
  /** Further conversations the store holds beside the active `conversation`. */
  otherConversations?: Conversation[];
  /** Append messages the run adds to the conversation instead of discarding them. */
  persistAddedMessages?: boolean;
}) {
  let idSequence = 0;
  let runSequence = 0;
  const activeConversationId = params.conversation.id;
  const conversationsById = new Map<string, Conversation>(
    [params.conversation, ...(params.otherConversations ?? [])].map((conversation) => [
      conversation.id,
      conversation,
    ]),
  );
  const commitConversation = (conversation: Conversation) => {
    conversationsById.set(conversation.id, conversation);
    useChatStore.setState({
      conversations: [...conversationsById.values()],
      activeConversationId,
    });
  };
  const updateConversation = (
    conversationId: string,
    update: (conversation: Conversation) => Conversation,
  ) => {
    const conversation = conversationsById.get(conversationId);
    if (conversation) commitConversation(update(conversation));
  };
  commitConversation(params.conversation);
  const projectionOwners = new Map<string, ModelProjectionOwner>();
  const projectionWaiters = new Map<string, Set<() => void>>();
  const noOp = jest.fn();
  const addMessage = params.persistAddedMessages
    ? jest.fn((conversationId: string, message: Partial<Message> & Pick<Message, 'role'>) =>
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: [
            ...conversation.messages,
            {
              ...message,
              id: message.id ?? `added-${conversation.messages.length}`,
              content: message.content ?? '',
              timestamp: message.timestamp ?? Date.now(),
            } as Message,
          ],
        })),
      )
    : noOp;
  const appendAgentRunCheckpoint = jest.fn((conversationId, entry, runId) =>
    updateConversation(conversationId, (conversation) =>
      appendAgentRunCheckpointInConversation(conversation, entry, runId),
    ),
  );
  const completeAgentRun = jest.fn((conversationId, completion, runId) =>
    updateConversation(conversationId, (conversation) =>
      completeAgentRunInConversation(conversation, completion, runId),
    ),
  );
  const setAgentRunPhase = jest.fn((conversationId, phase, phaseParams, runId) =>
    updateConversation(conversationId, (conversation) =>
      setAgentRunPhaseInConversation(conversation, phase, phaseParams, runId),
    ),
  );
  const startAgentRun = jest.fn((conversationId, runParams) => {
    const runId = `run-${++runSequence}`;
    updateConversation(conversationId, (conversation) =>
      startAgentRunInConversation(conversation, {
        ...runParams,
        runId,
        timestamp: Date.now(),
      }),
    );
    return runId;
  });
  const updateAgentRunAsyncWork = jest.fn((conversationId, patch, runId) =>
    updateConversation(conversationId, (conversation) =>
      updateAgentRunAsyncWorkInConversation(conversation, patch, runId),
    ),
  );
  const updateAgentRunControlGraph = jest.fn((conversationId, controlGraph, runId) =>
    updateConversation(conversationId, (conversation) =>
      updateAgentRunControlGraphInConversation(conversation, controlGraph, runId),
    ),
  );
  const updateAgentRunSummary = jest.fn((conversationId, patch, runId) =>
    updateConversation(conversationId, (conversation) =>
      updateAgentRunSummaryInConversation(conversation, patch, runId),
    ),
  );
  const updateMessage = jest.fn((conversationId: string, messageId: string, content: string) =>
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId ? { ...message, content } : message,
      ),
    })),
  );
  const updateMessageAssistantMetadata = jest.fn(
    (
      conversationId: string,
      messageId: string,
      assistantMetadata: Conversation['messages'][number]['assistantMetadata'],
    ) =>
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === messageId ? { ...message, assistantMetadata } : message,
        ),
      })),
  );
  const applyMobileControllerOutcome = jest.fn((conversationId, input) => {
    const conversation = conversationsById.get(conversationId);
    if (!conversation) {
      return { status: 'rejected' as const, reason: 'run_unavailable' as const };
    }
    const outcome = applyMobileControllerOutcomeInConversation(conversation, input);
    if (outcome.status === 'applied') commitConversation(outcome.conversation);
    return outcome;
  });
  const flushChatState = jest.fn().mockResolvedValue(undefined);
  const createModelExecution = jest.fn(async (input) => ({
    runId: input.runId,
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
      claimModelProjection: jest.fn(({ conversationId, owner, assistantMessage }) => {
        const current = projectionOwners.get(conversationId);
        if (current && current.runId !== owner.runId) return 'owner_conflict' as const;
        projectionOwners.set(conversationId, owner);
        updateConversation(conversationId, (conversation) => {
          const shouldAppendAssistant =
            assistantMessage &&
            !conversation.messages.some((message) => message.id === assistantMessage.id);
          return {
            ...conversation,
            messages: shouldAppendAssistant
              ? [...conversation.messages, assistantMessage]
              : conversation.messages,
            modelProjectionOwner: owner,
          };
        });
        return 'claimed' as const;
      }),
      completeModelExecution,
      createModelExecution,
      flushChatState,
      ownsModelProjection: jest.fn(
        (conversationId, owner) => projectionOwners.get(conversationId)?.runId === owner.runId,
      ),
      mutateModelProjection: jest.fn(({ conversationId, owner, mutate }) => {
        const conversation = conversationsById.get(conversationId);
        if (!conversation || projectionOwners.get(conversationId)?.runId !== owner.runId) {
          return { kind: 'owner_changed' as const };
        }
        const result = mutate(conversation);
        if (result.kind === 'applied') {
          commitConversation(result.conversation);
          return { kind: 'applied' as const, value: result.value };
        }
        return result;
      }),
      relinquishModelExecutionProcessOwnership: jest.fn(),
      releaseModelProjection: jest.fn(({ conversationId, owner }) => {
        if (projectionOwners.get(conversationId)?.runId !== owner.runId) {
          return 'owner_changed' as const;
        }
        projectionOwners.delete(conversationId);
        updateConversation(conversationId, (conversation) => {
          const { modelProjectionOwner: _modelProjectionOwner, ...releasedConversation } =
            conversation;
          return releasedConversation;
        });
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
            () => reject(new Error('model_projection_wait_cancelled')),
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
      ensureConversation: params.ensureConversation,
      getConversation: (conversationId: string) => conversationsById.get(conversationId),
      getConversations: () => [...conversationsById.values()],
      getResumeAgentRun: () => null,
      recordConversationTurnMemory: params.recordConversationTurnMemory,
      requestPersistenceCheckpoint: noOp,
      setChatError: noOp,
    },
    refs: {
      forceNextScrollRef: { current: false },
      pendingAgentRunAsyncResumesRef: { current: new Map() },
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
      addMessage,
      applyMobileControllerOutcome,
      addToolCall: noOp,
      appendAgentRunCheckpoint,
      applyConversationCompaction: noOp,
      completeAgentRun,
      resetConversationContext: params.resetConversationContext ?? jest.fn(() => true),
      setAgentRunPhase,
      startAgentRun,
      updateAgentRunAsyncWork,
      updateAgentRunControlGraph,
      updateAgentRunSummary,
      updateMessage,
      updateMessageAssistantMetadata,
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
    getCurrentConversation: () => conversationsById.get(activeConversationId)!,
  };
}
