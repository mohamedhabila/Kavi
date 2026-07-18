import type { Message } from '../../../types/message';
import { runOrchestrator } from '../../orchestrator';
import type { OrchestratorTerminalDisposition } from '../../orchestrator/types';
import { resolveConversationWorkspaceTarget } from '../../../services/conversationWorkspace/ownership';
import { isAbortErrorLike } from '../../../services/agents/agentRunCancellation';
import { createAgentRunAbortError } from '../../../services/runtimeError';
import { supersedeForegroundConversationRun } from '../foregroundConversationCancellation';
import { prepareAgentRunResumeForOrchestrator } from '../runResumePreparation';
import { deduplicateToolResults, ensureToolResultPairing } from '../../toolResultPairingGuard';
import { startOrReuseForegroundTrackedRun } from './bootstrap';
import { createForegroundConversationRunRuntime } from './executionRuntime';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';
import { resolveForegroundRunPreflight } from './preflight';
import {
  completeForegroundRunRequestBootstrap,
  prepareForegroundRunRequestBootstrap,
  prepareForegroundRunRequestClaim,
  type ForegroundRunRequestClaim,
  type ForegroundRunRequestBootstrapResult,
} from './requestBootstrap';
import { resolveForegroundConversationExecutionContext } from './executionContext';
import { acquireMainInferenceLease } from '../../../services/memory/onDeviceGuards';
import { requestScheduledIngestionDrain } from '../../../services/memory/ingestionQueue';
import { modelProjectionOwnerForForegroundLease } from '../../../services/executionJournal/foregroundModelExecutionJournal';
import type { ForegroundModelExecutionLease } from '../../../services/executionJournal/foregroundModelExecutionTypes';
import type { ModelProjectionOwner } from '../../../types/conversation';
import { modelProjectionOwnersEqual } from '../../../utils/modelProjectionOwner';
import { beginModelProjectionIntent } from '../../../store/modelProjectionIntentCoordinator';
import {
  buildForegroundProjectionReservation,
  claimForegroundProjectionReservation,
  terminalizeAndReleaseForegroundProjectionReservation,
} from './projectionReservation';
import {
  commitPendingVerifiedProcedureObservation,
  type PendingVerifiedProcedureObservation,
} from '../../../services/memory/verifiedProcedure/executionSession';
import { resolveGraphTaskId } from '../../goals/graphTaskScope';
import { enforceSemanticMemoryHandoffGate } from './semanticMemoryHandoffGate';
import { publishForegroundTerminalMemory } from './terminalMemoryPublication';
import { resolveExternalActionContract } from '../../externalActionContract';

function buildModelReadyMessages(messages: Message[]): Message[] {
  return deduplicateToolResults(ensureToolResultPairing(messages));
}

export async function executeForegroundConversationRun(
  params: ExecuteForegroundConversationRunParams,
): Promise<void> {
  const externalActionContract = resolveExternalActionContract(
    params.options?.externalActionContract,
    params.options?.disableTools === true,
  );
  const normalizedParams: ExecuteForegroundConversationRunParams = externalActionContract
    ? {
        ...params,
        options: { ...params.options, externalActionContract },
      }
    : params;
  const { context, conversationId, options } = normalizedParams;
  const requestClaim = prepareForegroundRunRequestClaim({
    createForegroundRequestId: context.helpers.createId,
    options,
    registerForegroundRequest: (requestId, abortController) => {
      context.requests.registerForegroundRequest(requestId, conversationId, abortController);
    },
    shouldAutoAbortPreviousForegroundRequest: (reason) => {
      context.requests.abortForegroundRequestForConversation(conversationId, reason);
    },
  });
  const projectionIntent = beginModelProjectionIntent(
    conversationId,
    requestClaim.foregroundRequestId,
  );
  try {
    await executeReservedForegroundConversationRun(normalizedParams, requestClaim);
  } finally {
    projectionIntent.release();
  }
}

async function executeReservedForegroundConversationRun(
  params: ExecuteForegroundConversationRunParams,
  requestClaim: ForegroundRunRequestClaim,
): Promise<void> {
  const { context, conversationId, options } = params;

  const { abortController, foregroundRequestId } = requestClaim;

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
  try {
    await context.durability.waitForRecoveryReadiness();
    await context.durability.waitForProjectionAvailability({
      conversationId,
      signal: abortController.signal,
    });
  } catch (error: unknown) {
    if (clearForegroundRequestIfCurrent()) {
      context.helpers.setChatError(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (!isCurrentRunInvocation()) {
    clearForegroundRequestIfCurrent();
    return;
  }
  const runConversation = context.helpers.getConversation(conversationId);
  const preparedBootstrap = prepareForegroundRunRequestBootstrap({
    claim: requestClaim,
    conversation: runConversation,
    createAssistantMessageId: context.helpers.createId,
    defaultConversationMode: context.state.defaultConversationMode,
    options,
  });
  if (preparedBootstrap.kind === 'reuse_unavailable') {
    clearForegroundRequestIfCurrent();
    return;
  }
  const { bootstrap } = preparedBootstrap.prepared;
  const resumePreparation = prepareAgentRunResumeForOrchestrator({
    existingRun: bootstrap.existingRun,
    fallbackUserMessageId: bootstrap.latestUserMessage?.id,
    messages: buildModelReadyMessages(runConversation?.messages ?? []),
  });
  if (resumePreparation.kind === 'unavailable') {
    clearForegroundRequestIfCurrent();
    context.helpers.setChatError(
      resumePreparation.reason === 'missing_existing_owner'
        ? 'The original request for this agent run is unavailable. Restore it before resuming.'
        : 'Foreground request message is missing.',
    );
    return;
  }
  const reservationRequest = resumePreparation.workflowScopeUserMessageId;
  let projectionOwner: ModelProjectionOwner | null = buildForegroundProjectionReservation({
    runId: foregroundRequestId,
    requestMessageId: reservationRequest,
    assistantMessageId: bootstrap.assistantMessageId,
  });
  try {
    await claimForegroundProjectionReservation({
      durability: context.durability,
      conversationId,
      owner: projectionOwner,
      insertAssistantPlaceholder: bootstrap.shouldInsertPlaceholderAssistant,
    });
  } catch (error: unknown) {
    if (context.durability.ownsModelProjection(conversationId, projectionOwner)) {
      await terminalizeAndReleaseForegroundProjectionReservation({
        durability: context.durability,
        conversationId,
        owner: projectionOwner,
        detail: `Projection reservation persistence failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    clearForegroundRequestIfCurrent();
    context.helpers.setChatError(error instanceof Error ? error.message : String(error));
    return;
  }
  let projectionClaimed = true;
  let projectionReleased = false;
  context.refs.forceNextScrollRef.current = true;
  context.requests.setStreamingMessageId(
    conversationId,
    foregroundRequestId,
    abortController,
    bootstrap.assistantMessageId,
  );

  const closeReservationFailure = async (detail: string) => {
    if (!projectionOwner || projectionReleased) return;
    await terminalizeAndReleaseForegroundProjectionReservation({
      durability: context.durability,
      conversationId,
      owner: projectionOwner,
      detail,
    });
    projectionReleased = true;
    projectionClaimed = false;
  };

  let preflight: Awaited<ReturnType<typeof resolveForegroundRunPreflight>>;
  try {
    preflight = await resolveForegroundRunPreflight({
      activeModel: context.state.activeModel,
      activeProviderId: context.state.activeProviderId,
      conversation: runConversation,
      conversationId,
      options,
      providers: context.state.providers,
      systemPrompt: context.state.systemPrompt,
    });
  } catch (error: unknown) {
    await closeReservationFailure(
      `Provider preflight failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    clearForegroundRequestIfCurrent();
    context.helpers.setChatError(error instanceof Error ? error.message : String(error));
    return;
  }
  if (preflight.kind !== 'ready') {
    const message =
      preflight.kind === 'missing_provider'
        ? context.state.chatNoProviderMessage
        : preflight.kind === 'missing_api_key'
          ? context.state.chatNoApiKeyMessage
          : context.state.chatNoModelMessage;
    await closeReservationFailure(`Provider preflight ended with ${preflight.kind}.`);
    clearForegroundRequestIfCurrent();
    context.helpers.setChatError(message);
    return;
  }
  if (!isCurrentRunInvocation()) {
    await closeReservationFailure('The request was superseded before generation started.');
    clearForegroundRequestIfCurrent();
    return;
  }

  const semanticMemoryGate = await enforceSemanticMemoryHandoffGate({
    signal: abortController.signal,
    conversation: runConversation,
    conversationId,
    durability: context.durability,
    owner: projectionOwner,
    closeReservationFailure,
    clearForegroundRequestIfCurrent,
    isCurrentRunInvocation,
    setChatError: context.helpers.setChatError,
  });
  if (semanticMemoryGate === 'stopped') return;

  const { finalizationProviderContext, model, provider, providerWithApiKey } = preflight;
  const executionContext = resolveForegroundConversationExecutionContext({
    conversation: runConversation,
    defaultConversationMode: context.state.defaultConversationMode,
  });
  let bootstrapResult: ForegroundRunRequestBootstrapResult;
  try {
    bootstrapResult = completeForegroundRunRequestBootstrap({
      prepared: preparedBootstrap.prepared,
      conversation: runConversation,
      startTrackedRun: (bootstrap) =>
        startOrReuseForegroundTrackedRun({
          bootstrap,
          clearTrackedRunCancellation: context.helpers.clearTrackedRunCancellation,
          conversationId,
          createUserMessageId: context.helpers.createId,
          startAgentRun: context.store.startAgentRun,
          workflowTaskAnchor: resumePreparation.workflowTaskAnchor,
        }),
      supersedeExistingRun: (runId, runningWorkerCount) => {
        if (!runConversation) {
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
          conversation: runConversation,
          conversationId,
          runId,
          runningWorkerCount,
        });
      },
    });
  } catch (error: unknown) {
    await closeReservationFailure(
      `Foreground bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    clearForegroundRequestIfCurrent();
    context.helpers.setChatError(error instanceof Error ? error.message : String(error));
    return;
  }
  const { assistantMessageId } = bootstrapResult;
  let executionLease: ForegroundModelExecutionLease | null = null;
  let pendingVerifiedProcedureObservation: PendingVerifiedProcedureObservation | undefined;
  let orchestratorTerminalDisposition: OrchestratorTerminalDisposition | undefined;
  let journalTerminal = false;
  let closingSupersededGeneration = false;
  const guardRunCallback = () =>
    isCurrentRunInvocation() &&
    (!projectionOwner || context.durability.ownsModelProjection(conversationId, projectionOwner));
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
  let completedHandoffStatus: 'succeeded' | 'failed' | null = null;

  const runtime = createForegroundConversationRunRuntime({
    bootstrapResult,
    clearForegroundRequestIfCurrent,
    completeRunOnce,
    conversation: runConversation,
    conversationId,
    executionContext,
    finalizationProviderContext,
    getCurrentConversation: () => context.helpers.getConversation(conversationId),
    guardRunCallback,
    isCurrentRunInvocation,
    model,
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
  const persistedProjectionMessages =
    latestConversationForRequest?.messages ?? runConversation?.messages ?? [];
  const modelReadyMessages = buildModelReadyMessages(
    bootstrap.shouldInsertPlaceholderAssistant
      ? persistedProjectionMessages.filter((message) => message.id !== bootstrap.assistantMessageId)
      : persistedProjectionMessages,
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
  const resolvedSystemPrompt = options?.additionalSystemPrompt
    ? [runConversation?.systemPrompt || context.state.systemPrompt, options.additionalSystemPrompt]
        .filter(Boolean)
        .join('\n\n')
    : runConversation?.systemPrompt || context.state.systemPrompt;
  const requestMessageId = resumePreparation.workflowScopeUserMessageId;
  const closeModelGenerationUnchecked = async (
    status: 'succeeded' | 'failed' | 'cancelled',
    options?: { allowIncompleteHandoff?: boolean },
  ): Promise<void> => {
    if (!executionLease) {
      throw new Error('foreground_model_journal_generation_missing');
    }
    let projectionMessageId = runtime.getCurrentAssistantMessageId();
    let terminalMemorySourceId: string | undefined;
    let journalStatus = status;
    if (!journalTerminal) {
      if (
        projectionOwner &&
        !context.durability.ownsModelProjection(conversationId, projectionOwner)
      ) {
        throw new Error('model_projection_ownership_changed');
      }
      let projectedConversation = context.helpers.getConversation(conversationId);
      const publication = await publishForegroundTerminalMemory({
        allowIncompleteHandoff: options?.allowIncompleteHandoff === true,
        assertProjectionOwnership: () => {
          if (
            projectionOwner &&
            !context.durability.ownsModelProjection(conversationId, projectionOwner)
          ) {
            throw new Error('model_projection_ownership_changed');
          }
        },
        conversation: projectedConversation,
        conversationId,
        currentAssistantMessageId: projectionMessageId,
        finalizationProviderContext,
        flushChatState: context.durability.flushChatState,
        getConversation: () => context.helpers.getConversation(conversationId),
        getConversations: context.helpers.getConversations,
        memoryConversationId: workspaceTarget.workspaceConversationId,
        orchestratorTerminalDisposition,
        recordConversationTurnMemory: context.helpers.recordConversationTurnMemory,
        runId: bootstrapResult.trackedAgentRunId,
        status,
        transitionMessageMemoryPublication: context.store.transitionMessageMemoryPublication,
      });
      projectedConversation = publication.conversation;
      journalStatus = publication.journalStatus;
      projectionMessageId = publication.projectionMessageId;
      terminalMemorySourceId = publication.terminalMemorySourceId;
      const projectionState = {
        conversationId,
        requestMessageId,
        projectionMessageId,
        terminalStatus: journalStatus,
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
      await context.durability.completeModelExecution({
        lease: executionLease,
        status: journalStatus,
        projectionMessageId,
        projectionState,
      });
      journalTerminal = true;
    }
    if (
      journalStatus === 'succeeded' &&
      terminalMemorySourceId &&
      pendingVerifiedProcedureObservation
    ) {
      const pending = pendingVerifiedProcedureObservation;
      pendingVerifiedProcedureObservation = undefined;
      const finalAgentRun = bootstrapResult.trackedAgentRunId
        ? context.helpers
            .getConversation(conversationId)
            ?.agentRuns?.find((run) => run.id === bootstrapResult.trackedAgentRunId)
        : undefined;
      await commitPendingVerifiedProcedureObservation({
        memoryLineage: {
          sourceMessageId: requestMessageId,
          sourceRunId: bootstrapResult.trackedAgentRunId ?? null,
          sourceTurnId: terminalMemorySourceId,
          taskId:
            resolveGraphTaskId({
              goals: finalAgentRun?.controlGraph?.goals,
              activeTaskId: finalAgentRun?.controlGraph?.activeTaskId,
            }) ?? null,
        },
        pending,
        surface: 'foreground',
        terminalObservedAt: Date.now(),
      }).catch(() => {
        // Learning is ancillary and cannot change a durably completed response.
      });
    }
    if (projectionOwner && !projectionReleased) {
      const release = context.durability.releaseModelProjection({
        conversationId,
        owner: projectionOwner,
      });
      if (release !== 'released') {
        throw new Error(`model_projection_${release}`);
      }
      await context.durability.flushChatState();
      projectionReleased = true;
    }
  };
  const closeModelGeneration = async (
    status: 'succeeded' | 'failed' | 'cancelled',
    options?: { allowIncompleteHandoff?: boolean },
  ): Promise<void> => {
    try {
      await closeModelGenerationUnchecked(status, options);
    } catch (error) {
      if (executionLease) {
        context.durability.relinquishModelExecutionProcessOwnership(executionLease.runId);
      }
      throw error;
    }
  };
  closeModelGenerationForHandoff = async (status) => {
    await closeModelGeneration(status, { allowIncompleteHandoff: true });
    completedHandoffStatus = status;
  };

  try {
    executionLease = await context.durability.createModelExecution({
      runId: foregroundRequestId,
      conversationId,
      requestMessageId,
      assistantMessageId,
      ...(bootstrapResult.trackedAgentRunId ? { taskId: bootstrapResult.trackedAgentRunId } : {}),
      requestState: {
        messages: orchestratorMessages,
        workflowScopeUserMessageId: requestMessageId,
        workflowTaskAnchor: resumePreparation.workflowTaskAnchor,
        initialAgentControlGraphState: resumePreparation.initialAgentControlGraphState,
        initialPendingAsyncOperations: options?.initialPendingAsyncOperations,
        memoryConversationId: workspaceTarget.workspaceConversationId,
        workspaceReadFallbackConversationId: workspaceTarget.workspaceReadFallbackConversationId,
        disableTools: options?.disableTools ?? false,
        allowedToolNames: options?.allowedToolNames,
        externalActionContract: options?.externalActionContract,
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
    if (!isCurrentRunInvocation()) {
      const terminalStatus = runtime.terminalLifecycle.handleCatch(
        createAgentRunAbortError('Request cancelled'),
      );
      closingSupersededGeneration = true;
      await closeModelGeneration(terminalStatus);
      return;
    }
    const journalOwner = modelProjectionOwnerForForegroundLease(executionLease);
    if (
      !projectionOwner ||
      !modelProjectionOwnersEqual(projectionOwner, journalOwner) ||
      !context.durability.ownsModelProjection(conversationId, projectionOwner)
    ) {
      throw new Error('model_projection_journal_owner_mismatch');
    }
    if (!isCurrentRunInvocation()) {
      const terminalStatus = runtime.terminalLifecycle.handleCatch(
        createAgentRunAbortError('Request cancelled'),
      );
      closingSupersededGeneration = true;
      await closeModelGeneration(terminalStatus);
      return;
    }
    executionLease = await context.durability.activateModelExecution({
      lease: executionLease,
    });
  } catch (error: unknown) {
    if (closingSupersededGeneration) {
      throw error;
    }
    const ownsClaim =
      projectionOwner && context.durability.ownsModelProjection(conversationId, projectionOwner);
    if (projectionOwner && !ownsClaim) {
      projectionOwner = null;
      projectionClaimed = false;
    }
    if (projectionClaimed) {
      runtime.terminalLifecycle.handleCatch(error);
    } else {
      clearForegroundRequestIfCurrent();
      context.helpers.setChatError(error instanceof Error ? error.message : String(error));
    }
    if (executionLease) {
      await closeModelGeneration(projectionClaimed ? 'failed' : 'cancelled');
    } else if (projectionOwner && projectionClaimed) {
      await closeReservationFailure(
        `Journal creation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }
  let terminalStatus: 'succeeded' | 'failed' | 'cancelled';
  if (!isCurrentRunInvocation()) {
    terminalStatus = runtime.terminalLifecycle.handleCatch(
      createAgentRunAbortError('Request cancelled'),
    );
  } else {
    const inferenceLease = acquireMainInferenceLease(
      `foreground:${conversationId}:${foregroundRequestId}`,
    );
    const mobileController = options?.mobileController;
    try {
      const orchestratorResult = await runOrchestrator(
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
          executionRunId: foregroundRequestId,
          allProviders: context.state.providers.map((candidate) => ({ ...candidate })),
          enableCompaction: options?.enableCompaction ?? true,
          enableFailover: true,
          disableTooling: options?.disableTools,
          externalActionContract: options?.externalActionContract,
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
          workflowTaskAnchor: resumePreparation.workflowTaskAnchor,
          agentRunId: bootstrapResult.trackedAgentRunId,
          memoryRetrievalStrategy: options?.memoryRetrievalStrategy,
          memoryContextStrategy: options?.memoryContextStrategy,
          ...(mobileController
            ? {
                mobileController: {
                  capability: mobileController.capability,
                  currentObservation: mobileController.currentObservation,
                  persistGraphState: () => context.durability.flushChatState(),
                  publishHandoff: (handoff) => mobileController.publishHandoff(handoff),
                },
              }
            : {}),
        },
        runtime.callbacks,
      );
      orchestratorTerminalDisposition = orchestratorResult.terminalDisposition;
      pendingVerifiedProcedureObservation = orchestratorResult.pendingVerifiedProcedureObservation;
      terminalStatus = await runtime.terminalLifecycle.awaitCompletion();
    } catch (error: unknown) {
      if (
        completedHandoffStatus &&
        journalTerminal &&
        projectionReleased &&
        isAbortErrorLike(error, abortController.signal)
      ) {
        // A controlled recovery closes and releases this generation before the
        // nested resume replaces its foreground request. The resulting abort
        // belongs to the completed handoff, not to response ownership loss.
        terminalStatus = completedHandoffStatus;
      } else if (
        projectionOwner &&
        !context.durability.ownsModelProjection(conversationId, projectionOwner)
      ) {
        projectionOwner = null;
        projectionClaimed = false;
        clearForegroundRequestIfCurrent();
        context.helpers.setChatError('Foreground response ownership changed.');
        terminalStatus = 'cancelled';
      } else {
        terminalStatus = runtime.terminalLifecycle.handleCatch(error);
      }
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
