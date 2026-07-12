import type { Conversation, ModelProjectionOwner } from '../../src/types/conversation';
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
  updateAgentRunPlanInConversation,
} from '../../src/store/agentRuns/graph';
import { useChatStore } from '../../src/store/useChatStore';

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
    finalizationProviderContext: {
      provider: providerWithApiKey,
      model,
      systemPromptText: params.conversation.systemPrompt,
      conversationId: params.conversation.id,
    },
  };
}

export function createExecutionContext(params: {
  conversation: Conversation;
  providers: LlmProviderConfig[];
  recordConversationTurnMemory: jest.Mock;
  ensureCanonicalConversation: jest.Mock;
}) {
  let idSequence = 0;
  let runSequence = 0;
  let currentConversation = params.conversation;
  const commitConversation = (conversation: Conversation) => {
    currentConversation = conversation;
    useChatStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
    });
  };
  commitConversation(currentConversation);
  const projectionOwners = new Map<string, ModelProjectionOwner>();
  const projectionWaiters = new Map<string, Set<() => void>>();
  const noOp = jest.fn();
  const appendAgentRunCheckpoint = jest.fn((conversationId, entry, runId) => {
    if (conversationId !== currentConversation.id) return;
    commitConversation(
      appendAgentRunCheckpointInConversation(currentConversation, entry, runId),
    );
  });
  const completeAgentRun = jest.fn((conversationId, completion, runId) => {
    if (conversationId !== currentConversation.id) return;
    commitConversation(completeAgentRunInConversation(currentConversation, completion, runId));
  });
  const setAgentRunPhase = jest.fn((conversationId, phase, phaseParams, runId) => {
    if (conversationId !== currentConversation.id) return;
    commitConversation(
      setAgentRunPhaseInConversation(currentConversation, phase, phaseParams, runId),
    );
  });
  const startAgentRun = jest.fn((conversationId, runParams) => {
    const runId = `run-${++runSequence}`;
    if (conversationId === currentConversation.id) {
      commitConversation(
        startAgentRunInConversation(currentConversation, {
          ...runParams,
          runId,
          timestamp: Date.now(),
        }),
      );
    }
    return runId;
  });
  const updateAgentRunAsyncWork = jest.fn((conversationId, patch, runId) => {
    if (conversationId !== currentConversation.id) return;
    commitConversation(
      updateAgentRunAsyncWorkInConversation(currentConversation, patch, runId),
    );
  });
  const updateAgentRunControlGraph = jest.fn((conversationId, controlGraph, runId) => {
    if (conversationId !== currentConversation.id) return;
    commitConversation(
      updateAgentRunControlGraphInConversation(currentConversation, controlGraph, runId),
    );
  });
  const updateAgentRunPlan = jest.fn((conversationId, patch, runId) => {
    if (conversationId !== currentConversation.id) return;
    commitConversation(updateAgentRunPlanInConversation(currentConversation, patch, runId));
  });
  const updateAgentRunSummary = jest.fn((conversationId, patch, runId) => {
    if (conversationId !== currentConversation.id) return;
    commitConversation(updateAgentRunSummaryInConversation(currentConversation, patch, runId));
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
        if (conversationId === currentConversation.id) {
          const shouldAppendAssistant =
            assistantMessage &&
            !currentConversation.messages.some((message) => message.id === assistantMessage.id);
          commitConversation({
            ...currentConversation,
            messages: shouldAppendAssistant
              ? [...currentConversation.messages, assistantMessage]
              : currentConversation.messages,
            modelProjectionOwner: owner,
          });
        }
        return 'claimed' as const;
      }),
      completeModelExecution,
      createModelExecution,
      flushChatState,
      ownsModelProjection: jest.fn(
        (conversationId, owner) => projectionOwners.get(conversationId)?.runId === owner.runId,
      ),
      mutateModelProjection: jest.fn(({ conversationId, owner, mutate }) => {
        if (
          conversationId !== currentConversation.id ||
          projectionOwners.get(conversationId)?.runId !== owner.runId
        ) {
          return { kind: 'owner_changed' as const };
        }
        const result = mutate(currentConversation);
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
        if (conversationId === currentConversation.id) {
          const { modelProjectionOwner: _modelProjectionOwner, ...releasedConversation } =
            currentConversation;
          commitConversation(releasedConversation);
        }
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
      ensureAgentRunFinalResponse: jest.fn(),
      ensureCanonicalConversation: params.ensureCanonicalConversation,
      getConversation: (conversationId: string) =>
        conversationId === currentConversation.id ? currentConversation : undefined,
      getConversations: () => [currentConversation],
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
      appendAgentRunCheckpoint,
      applyConversationCompaction: noOp,
      completeAgentRun,
      setAgentRunPhase,
      startAgentRun,
      updateAgentRunAsyncWork,
      updateAgentRunControlGraph,
      updateAgentRunPlan,
      updateAgentRunSummary,
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
    getCurrentConversation: () => currentConversation,
  };
}
