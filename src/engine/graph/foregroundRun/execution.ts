import type { Message } from '../../../types/message';
import { runOrchestrator } from '../../orchestrator';
import { resolveConversationWorkspaceTarget } from '../../../services/conversationWorkspace/ownership';
import { supersedeForegroundConversationRun } from '../foregroundConversationCancellation';
import { prepareAgentRunResumeForOrchestrator } from '../runResumePreparation';
import { deduplicateToolResults, ensureToolResultPairing } from '../../toolResultPairingGuard';
import { startOrReuseForegroundTrackedRun } from './bootstrap';
import { createForegroundConversationRunRuntime } from './executionRuntime';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';
import { resolveForegroundRunPreflight } from './preflight';
import { prepareForegroundRunRequestBootstrap } from './requestBootstrap';
import { resolveForegroundConversationExecutionContext } from './executionContext';
import { acquireMainInferenceLease } from '../../../services/memory/onDeviceGuards';
import { requestScheduledIngestionDrain } from '../../../services/memory/ingestionQueue';
import type { ForegroundModelExecutionLease } from '../../../services/executionJournal/foregroundModelExecutionJournal';

function buildModelReadyMessages(messages: Message[]): Message[] {
  return deduplicateToolResults(ensureToolResultPairing(messages));
}

export async function executeForegroundConversationRun(
  params: ExecuteForegroundConversationRunParams,
): Promise<void> {
  const { context, conversationId, options } = params;
  const conversation = context.helpers.getConversation(conversationId);
  const executionContext = resolveForegroundConversationExecutionContext({
    conversation,
    defaultConversationMode: context.state.defaultConversationMode,
  });
  const preflight = await resolveForegroundRunPreflight({
    activeModel: context.state.activeModel,
    activeProviderId: context.state.activeProviderId,
    conversation,
    conversationId,
    options,
    providers: context.state.providers,
    systemPrompt: context.state.systemPrompt,
  });

  if (preflight.kind === 'missing_provider') {
    context.helpers.setChatError(context.state.chatNoProviderMessage);
    return;
  }
  if (preflight.kind === 'missing_api_key') {
    context.helpers.setChatError(context.state.chatNoApiKeyMessage);
    return;
  }
  if (preflight.kind === 'missing_model') {
    context.helpers.setChatError(context.state.chatNoModelMessage);
    return;
  }

  const { finalizationProviderContext, model, provider, providerWithApiKey } = preflight;
  const bootstrapResult = prepareForegroundRunRequestBootstrap({
    conversation,
    conversationId,
    createAssistantMessageId: context.helpers.createId,
    createForegroundRequestId: context.helpers.createId,
    defaultConversationMode: context.state.defaultConversationMode,
    options,
    registerForegroundRequest: (requestId, abortController) => {
      context.requests.registerForegroundRequest(requestId, conversationId, abortController);
    },
    shouldAutoAbortPreviousForegroundRequest: (reason) => {
      context.requests.abortForegroundRequestForConversation(conversationId, reason);
    },
    startTrackedRun: (bootstrap) =>
      startOrReuseForegroundTrackedRun({
        bootstrap,
        clearTrackedRunCancellation: context.helpers.clearTrackedRunCancellation,
        conversationId,
        createUserMessageId: context.helpers.createId,
        startAgentRun: context.store.startAgentRun,
      }),
    supersedeExistingRun: (runId, runningWorkerCount) => {
      if (!conversation) {
        return;
      }

      supersedeForegroundConversationRun({
        actions: {
          appendConversationLog: context.helpers.appendConversationLog,
          clearPendingRunState: context.helpers.clearPendingRunState,
          completeAgentRun: context.store.completeAgentRun,
          getLatestConversation: context.helpers.getConversation,
          updateAgentRunControlGraph: context.store.updateAgentRunControlGraph,
        },
        conversation,
        conversationId,
        runId,
        runningWorkerCount,
      });
    },
  });

  const { abortController, assistantMessageId, bootstrap, foregroundRequestId } = bootstrapResult;
  context.refs.forceNextScrollRef.current = true;
  if (bootstrap.shouldInsertPlaceholderAssistant) {
    context.store.addMessage(conversationId, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
    });
  }
  context.requests.setStreamingMessageId(
    conversationId,
    foregroundRequestId,
    abortController,
    assistantMessageId,
  );

  const clearForegroundRequestIfCurrent = () => {
    if (
      !context.requests.isCurrentForegroundRequest(
        conversationId,
        foregroundRequestId,
        abortController,
      )
    ) {
      return false;
    }

    context.requests.clearForegroundRequest(conversationId, foregroundRequestId, abortController);
    return true;
  };
  const isCurrentRunInvocation = () =>
    context.requests.isCurrentForegroundRequest(
      conversationId,
      foregroundRequestId,
      abortController,
    ) && !abortController.signal.aborted;
  const guardRunCallback = () => isCurrentRunInvocation();
  const workspaceTarget = resolveConversationWorkspaceTarget({
    conversationId,
    conversations: context.helpers.getConversations(),
  });
  let hasCompletedRunCallbacks = false;
  const completeRunOnce = async (task: () => Promise<void> | void) => {
    if (!isCurrentRunInvocation() || hasCompletedRunCallbacks) {
      return;
    }
    hasCompletedRunCallbacks = true;
    await task();
  };

  const runtime = createForegroundConversationRunRuntime({
    bootstrapResult,
    clearForegroundRequestIfCurrent,
    completeRunOnce,
    conversation,
    conversationId,
    executionContext,
    finalizationProviderContext,
    getCurrentConversation: () => context.helpers.getConversation(conversationId),
    guardRunCallback,
    isCurrentRunInvocation,
    model,
    memoryConversationId: workspaceTarget.workspaceConversationId,
    options,
    provider,
    shared: context,
  });

  const latestConversationForRequest = context.helpers.getConversation(conversationId);
  const modelReadyMessages = buildModelReadyMessages(
    latestConversationForRequest?.messages ?? conversation?.messages ?? [],
  );
  const additionalInternalPrompt = options?.additionalUserPrompt?.trim() || '';
  const allowedToolNames = options?.allowedToolNames
    ? new Set(options.allowedToolNames)
    : undefined;
  const orchestratorMessages = additionalInternalPrompt
    ? [
        ...modelReadyMessages,
        {
          id: context.helpers.createId(),
          role: 'system' as const,
          content: additionalInternalPrompt,
          timestamp: Date.now(),
        },
      ]
    : modelReadyMessages;
  const resumePreparation = prepareAgentRunResumeForOrchestrator({
    existingRun: bootstrap.existingRun,
    fallbackUserMessageId: bootstrap.latestUserMessage?.id,
    messages: orchestratorMessages,
  });
  const resolvedSystemPrompt = options?.additionalSystemPrompt
    ? [conversation?.systemPrompt || context.state.systemPrompt, options.additionalSystemPrompt]
        .filter(Boolean)
        .join('\n\n')
    : conversation?.systemPrompt || context.state.systemPrompt;
  const requestMessageId = resumePreparation.workflowScopeUserMessageId;
  if (!requestMessageId) {
    runtime.terminalLifecycle.handleCatch(
      new Error('foreground_model_journal_request_message_missing'),
    );
    await context.durability.flushChatState();
    return;
  }
  let executionLease: ForegroundModelExecutionLease;
  try {
    await context.durability.flushChatState();
    executionLease = await context.durability.beginModelExecution({
      conversationId,
      requestMessageId,
      assistantMessageId,
      ...(bootstrapResult.trackedAgentRunId
        ? { taskId: bootstrapResult.trackedAgentRunId }
        : {}),
      requestState: {
        messages: orchestratorMessages,
        workflowScopeUserMessageId: requestMessageId,
        initialAgentControlGraphState: resumePreparation.initialAgentControlGraphState,
        initialPendingAsyncOperations: options?.initialPendingAsyncOperations,
        memoryConversationId: workspaceTarget.workspaceConversationId,
        workspaceReadFallbackConversationId: workspaceTarget.workspaceReadFallbackConversationId,
        disableTools: options?.disableTools ?? false,
        allowedToolNames: options?.allowedToolNames,
        memoryRetrievalStrategy: options?.memoryRetrievalStrategy,
        memoryContextStrategy: options?.memoryContextStrategy,
      },
      modelState: {
        providerId: provider.id,
        model,
        personaId: executionContext.personaId,
        systemPrompt: resolvedSystemPrompt,
        maxTokens: options?.maxTokens,
        enableCompaction: options?.enableCompaction ?? true,
        thinkingLevel: context.state.thinkingLevel,
      },
    });
  } catch (error: unknown) {
    runtime.terminalLifecycle.handleCatch(error);
    await context.durability.flushChatState();
    return;
  }
  const inferenceLease = acquireMainInferenceLease(
    `foreground:${conversationId}:${foregroundRequestId}`,
  );
  let terminalStatus: 'succeeded' | 'failed' | 'cancelled';
  try {
    await runOrchestrator(
      {
        provider: providerWithApiKey,
        model,
        conversationId,
        memoryConversationId: workspaceTarget.workspaceConversationId,
        workspaceConversationId: workspaceTarget.workspaceConversationId,
        workspaceReadFallbackConversationId: workspaceTarget.workspaceReadFallbackConversationId,
        systemPrompt: resolvedSystemPrompt,
        messages: orchestratorMessages,
        maxTokens: options?.maxTokens,
        signal: abortController,
        personaId: executionContext.personaId,
        taskId: resumePreparation.initialAgentControlGraphState?.activeTaskId ?? null,
        allProviders: context.state.providers.map((candidate) => ({ ...candidate })),
        enableCompaction: options?.enableCompaction ?? true,
        enableFailover: true,
        thinkingLevel: context.state.thinkingLevel,
        linkUnderstandingEnabled: context.state.linkUnderstandingEnabled,
        mediaUnderstandingEnabled: context.state.mediaUnderstandingEnabled,
        maxLinks: context.state.maxLinks,
        toolFilter: options?.disableTools
          ? () => false
          : allowedToolNames
            ? (toolName) => allowedToolNames.has(toolName)
            : undefined,
        internalUserMessageCount: 0,
        initialPendingAsyncOperations: options?.initialPendingAsyncOperations,
        initialAgentControlGraphState: resumePreparation.initialAgentControlGraphState,
        workflowScopeUserMessageId: resumePreparation.workflowScopeUserMessageId,
        agentRunId: bootstrapResult.trackedAgentRunId,
        memoryRetrievalStrategy: options?.memoryRetrievalStrategy,
        memoryContextStrategy: options?.memoryContextStrategy,
      },
      runtime.callbacks,
    );
    terminalStatus = await runtime.terminalLifecycle.awaitCompletion();
  } catch (error: unknown) {
    terminalStatus = runtime.terminalLifecycle.handleCatch(error);
  } finally {
    if (inferenceLease.release()) {
      requestScheduledIngestionDrain();
    }
  }
  await context.durability.flushChatState();
  const projectionMessageId = runtime.getCurrentAssistantMessageId();
  const projectedConversation = context.helpers.getConversation(conversationId);
  await context.durability.completeModelExecution({
    lease: executionLease,
    status: terminalStatus,
    projectionMessageId,
    projectionState: {
      conversationId,
      requestMessageId,
      projectionMessageId,
      terminalStatus,
      assistantMessage: projectedConversation?.messages.find(
        (message) => message.id === projectionMessageId,
      ),
      agentRun: bootstrapResult.trackedAgentRunId
        ? projectedConversation?.agentRuns?.find(
            (run) => run.id === bootstrapResult.trackedAgentRunId,
          )
        : undefined,
    },
  });
}
