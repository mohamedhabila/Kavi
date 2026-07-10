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
import { foregroundModelProjectionOwnerForLease } from '../../../services/executionJournal/foregroundModelExecutionJournal';
import type { ForegroundModelExecutionLease } from '../../../services/executionJournal/foregroundModelExecutionTypes';
import type { ForegroundModelProjectionOwner } from '../../../types/conversation';

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
  let executionLease: ForegroundModelExecutionLease | null = null;
  let projectionOwner: ForegroundModelProjectionOwner | null = null;
  let journalTerminal = false;
  let projectionReleased = false;
  const guardRunCallback = () =>
    isCurrentRunInvocation() &&
    (!projectionOwner ||
      context.durability.ownsModelProjection(conversationId, projectionOwner));
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

  let closeModelGenerationForHandoff: (
    status: 'succeeded' | 'failed',
  ) => Promise<void> = async () => {
    throw new Error('foreground_model_journal_handoff_not_ready');
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
    wrapResumeAgentRun: (resume, terminalStatus) =>
      resume
        ? async (resumeParams) => {
            await closeModelGenerationForHandoff(terminalStatus);
            await resume(resumeParams);
          }
        : null,
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
  const closeModelGeneration = async (
    status: 'succeeded' | 'failed' | 'cancelled',
  ): Promise<void> => {
    if (!executionLease) {
      throw new Error('foreground_model_journal_generation_missing');
    }
    const projectionMessageId = runtime.getCurrentAssistantMessageId();
    if (!journalTerminal) {
      if (
        projectionOwner &&
        !context.durability.ownsModelProjection(conversationId, projectionOwner)
      ) {
        throw new Error('foreground_model_projection_ownership_changed');
      }
      const projectedConversation = context.helpers.getConversation(conversationId);
      const projectionState = {
        conversationId,
        requestMessageId,
        projectionMessageId,
        terminalStatus: status,
        projectionOwner,
        assistantMessage: projectedConversation?.messages.find(
          (message) => message.id === projectionMessageId,
        ),
        agentRun: bootstrapResult.trackedAgentRunId
          ? projectedConversation?.agentRuns?.find(
              (run) => run.id === bootstrapResult.trackedAgentRunId,
            )
          : undefined,
      };
      if (projectionOwner) {
        await context.durability.flushChatState();
        if (!context.durability.ownsModelProjection(conversationId, projectionOwner)) {
          throw new Error('foreground_model_projection_ownership_changed');
        }
      }
      await context.durability.completeModelExecution({
        lease: executionLease,
        status,
        projectionMessageId,
        projectionState,
      });
      journalTerminal = true;
    }
    if (projectionOwner && !projectionReleased) {
      const release = context.durability.releaseModelProjection({
        conversationId,
        owner: projectionOwner,
      });
      if (release !== 'released') {
        throw new Error(`foreground_model_projection_${release}`);
      }
      await context.durability.flushChatState();
      projectionReleased = true;
    }
  };
  closeModelGenerationForHandoff = (status) => closeModelGeneration(status);

  try {
    executionLease = await context.durability.createModelExecution({
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
    projectionOwner = foregroundModelProjectionOwnerForLease(executionLease);
    const claim = context.durability.claimModelProjection({
      conversationId,
      owner: projectionOwner,
      ...(bootstrap.shouldInsertPlaceholderAssistant
        ? {
            assistantMessage: {
              id: assistantMessageId,
              role: 'assistant' as const,
              content: '',
              timestamp: Date.now(),
            },
          }
        : {}),
    });
    if (claim !== 'claimed') {
      projectionOwner = null;
      throw new Error(`foreground_model_projection_${claim}`);
    }
    await context.durability.flushChatState();
    if (!context.durability.ownsModelProjection(conversationId, projectionOwner)) {
      throw new Error('foreground_model_projection_ownership_changed');
    }
    executionLease = await context.durability.activateModelExecution({
      lease: executionLease,
    });
  } catch (error: unknown) {
    if (
      projectionOwner &&
      !context.durability.ownsModelProjection(conversationId, projectionOwner)
    ) {
      throw new Error('foreground_model_projection_ownership_changed');
    }
    runtime.terminalLifecycle.handleCatch(error);
    if (executionLease) {
      await closeModelGeneration('failed');
    } else {
      await context.durability.flushChatState();
    }
    return;
  }
  let terminalStatus: 'succeeded' | 'failed' | 'cancelled';
  if (!isCurrentRunInvocation()) {
    terminalStatus = runtime.terminalLifecycle.handleCatch(new Error('Request cancelled'));
  } else {
    const inferenceLease = acquireMainInferenceLease(
      `foreground:${conversationId}:${foregroundRequestId}`,
    );
    try {
      await runOrchestrator(
        {
          provider: providerWithApiKey,
          model,
          conversationId,
          memoryConversationId: workspaceTarget.workspaceConversationId,
          workspaceConversationId: workspaceTarget.workspaceConversationId,
          workspaceReadFallbackConversationId:
            workspaceTarget.workspaceReadFallbackConversationId,
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
      if (
        projectionOwner &&
        !context.durability.ownsModelProjection(conversationId, projectionOwner)
      ) {
        throw new Error('foreground_model_projection_ownership_changed');
      }
      terminalStatus = runtime.terminalLifecycle.handleCatch(error);
    } finally {
      if (inferenceLease.release()) {
        requestScheduledIngestionDrain();
      }
    }
  }
  if (!journalTerminal) {
    await closeModelGeneration(terminalStatus);
  }
}
