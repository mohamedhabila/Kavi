import { DefaultContextEngine } from '../../services/context/compaction';
import { recordUsage } from '../../services/usage/tracker';
import { createLogger } from '../../utils/logger';
import { isJestRuntime } from '../../utils/runtime';

import { createOrchestratorGraphBindings } from '../graph/orchestratorGraphBindings';
import { resolveGraphEntryRequestDecision } from '../graph/requestDecisionSignals';
import { executeAgentControlGraphSession } from '../graph/sessionExecution';
import {
  loadOrchestratorMemoryAccessContext,
  prepareOrchestratorRequestBundle,
} from '../orchestratorRequestPreparation';
import { buildRuntimeContextNote } from '../prompts/orchestratorPromptSections';
import { yieldToUiFrame } from '../toolExecution/toolCallLifecycleRecording';
import { prepareOrchestratorSessionBootstrap } from './bootstrap';
import type { OrchestratorCallbacks, OrchestratorOptions } from './types';
import {
  resolveCodeOwnedMemoryConversationId,
  resolveCodeOwnedMemoryPersonaId,
} from '../../services/memory/memoryScopeIdentity';
import { persistConversationModeEscalation } from '../graph/conversation/persistModeEscalation';
import { buildRuntimeRequestDecisionToolAuthority } from './requestDecisionAuthority';
import {
  createVerifiedProcedureExecutionSession,
  type PendingVerifiedProcedureObservation,
} from '../../services/memory/verifiedProcedure/executionSession';
import type { OrchestratorRunResult, OrchestratorTerminalDisposition } from './types';
import type { AssistantMessageMetadata } from '../../types/message';
import { resolveWorkflowTaskAnchor } from '../graph/workflowTaskAnchor';
import { getActiveGoal } from '../goals/types';
import { admitSessionMemoryContext } from '../graph/sessionMemoryContext';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../authority/modelTurnMemoryPolicyBinding';
import { rebuildSessionMemoryRefreshMessages } from './sessionMemoryRefreshMessages';
import { buildMobileControllerPublishedHandoff } from '../mobileController/publication';
import { resolveRuntimeExplicitToolSurfaceToolNames } from '../tools/runtimeAvailability';

const logger = createLogger('Orchestrator');

export async function runOrchestratorGraphSession(params: {
  options: OrchestratorOptions;
  callbacks: OrchestratorCallbacks;
  sessionBootstrap: Awaited<ReturnType<typeof prepareOrchestratorSessionBootstrap>>;
}): Promise<OrchestratorRunResult> {
  const { options, callbacks, sessionBootstrap } = params;
  const {
    activeModel,
    activeProvider,
    allTools,
    catalogVisibleToolNames,
    consecutivePendingAsyncNoToolTurns,
    emitPendingAsyncOperationsChange,
    failoverState,
    isSuperAgent,
    startsAgentic,
    allowLongHorizonIterationExtensions,
    lastPendingAsyncSignature,
    llm,
    maxToolIterations,
    mobileControllerRuntime,
    persona,
    resolvedPrompt,
    runtimeToolAvailability,
    toolCallHistory,
    stagnationSignatures,
    trackedAsyncOperations,
    warningInjectedThisRound,
  } = sessionBootstrap;

  const {
    conversationId,
    usageConversationId = conversationId,
    enableCompaction = true,
    linkUnderstandingEnabled = false,
    mediaUnderstandingEnabled = false,
    maxLinks = 3,
    internalUserMessageCount = 0,
    maxTokens = 32_000,
    temperature,
    thinkingLevel = 'off',
    signal,
    allProviders,
  } = options;
  const personaId = resolveCodeOwnedMemoryPersonaId(options.personaId);
  const taskId = options.taskId ?? null;

  const availableToolNames = new Set(allTools.map((tool) => tool.name));
  const explicitToolSurfaceToolNames = resolveRuntimeExplicitToolSurfaceToolNames(
    options.explicitToolSurfaceToolNames,
    runtimeToolAvailability,
  );
  const compactionEngine = enableCompaction ? new DefaultContextEngine() : null;
  const sharedConversationId = resolveCodeOwnedMemoryConversationId(
    options.memoryConversationId,
    conversationId,
  );
  const runtimeContextNote = buildRuntimeContextNote();
  const verifiedProcedureSession = await createVerifiedProcedureExecutionSession({
    executionRunId: options.executionRunId,
    memoryConversationId: sharedConversationId,
    sourceThreadId: conversationId,
  });
  const workflowTaskAnchor = (() => {
    if (options.workflowTaskAnchor) {
      if (
        options.workflowScopeUserMessageId &&
        options.workflowTaskAnchor.sourceMessageId !== options.workflowScopeUserMessageId
      ) {
        throw new Error('workflow_task_anchor_owner_mismatch');
      }
      return options.workflowTaskAnchor;
    }
    if (!isSuperAgent) return undefined;
    // The anchor protects task fidelity across long, delegation-capable execution; a
    // plain interactive agentic turn that cannot delegate does not need it. A run
    // that can spawn workers (sessions_spawn on its surface), or is itself a
    // delegated worker, does. Every interactive foreground chat turn carries a
    // workflowScopeUserMessageId; a worker run (see subAgentOrchestratorRun.ts)
    // never sets one, so its absence is the in-scope signal for "this is a worker".
    const canDelegateOrIsDelegatedWorker =
      availableToolNames.has('sessions_spawn') || !options.workflowScopeUserMessageId;
    if (!canDelegateOrIsDelegatedWorker) return undefined;
    const resolution = resolveWorkflowTaskAnchor({
      messages: options.messages,
      sourceMessageId: options.workflowScopeUserMessageId,
      existingOwner: Boolean(options.workflowScopeUserMessageId),
    });
    if (resolution.kind === 'unavailable') {
      throw new Error(`workflow_task_anchor_${resolution.reason}`);
    }
    return resolution.anchor;
  })();

  const {
    currentUserMessage,
    livingMemory,
    memoryConsistencyBarrier,
    memoryRefreshInternalUserMessages,
    requestFrame: structuralRequestFrame,
    skillPrompts,
    workingMessages,
  } = await prepareOrchestratorRequestBundle({
    activeModel,
    activeProvider,
    callbacks,
    conversationId,
    // Mode is a conversation property, not a persona flag: `startsAgentic` is the
    // conversation's own persisted mode (resolved once in bootstrap.ts, falling back
    // to the persona signal only for worker sessions that are never registered as a
    // UI conversation) instead of re-deriving it from `isSuperAgent`.
    // `RequestUnderstandingRouting.mode` and every other per-turn consumer of
    // `requestFrame.mode` inherit this through `requestContext.ts`.
    graphOwnedRun: startsAgentic,
    internalUserMessageCount,
    linkUnderstandingEnabled,
    logger,
    maxLinks,
    mediaUnderstandingEnabled,
    memoryConversationId: sharedConversationId,
    messages: options.messages,
    personaId,
    taskId,
    workflowScopeUserMessageId: options.workflowScopeUserMessageId,
    graphSnapshot: options.initialAgentControlGraphState,
    memoryRetrievalStrategy: options.memoryRetrievalStrategy,
    memoryContextStrategy: options.memoryContextStrategy,
  });
  const requestFrame = resolveGraphEntryRequestDecision({
    frame: structuralRequestFrame,
    graphSnapshot: options.initialAgentControlGraphState,
    toolAuthority: buildRuntimeRequestDecisionToolAuthority({
      availableToolNames,
      personaId,
    }),
  });
  const admittedMemoryContext = admitSessionMemoryContext({
    consistencyBarrier: memoryConsistencyBarrier,
    livingMemory,
  });
  let finalAssistant:
    | Readonly<{ content: string; metadata?: AssistantMessageMetadata }>
    | undefined;
  const graphCallbacks = {
    ...callbacks,
    onAssistantMessage: (
      content: string,
      toolCalls?: Parameters<typeof callbacks.onAssistantMessage>[1],
      providerReplay?: Parameters<typeof callbacks.onAssistantMessage>[2],
      assistantMetadata?: AssistantMessageMetadata,
    ) => {
      if (assistantMetadata?.kind === 'final' && content.trim()) {
        finalAssistant = { content, metadata: assistantMetadata };
      }
      callbacks.onAssistantMessage(content, toolCalls, providerReplay, assistantMetadata);
    },
  };

  const graph = createOrchestratorGraphBindings({
    callbacks: graphCallbacks,
    conversationId,
    initialMessages: workingMessages,
    initialSnapshot: options.initialAgentControlGraphState,
    workflowScopeUserMessageId: options.workflowScopeUserMessageId,
    trackedAsyncOperations,
    activeProvider,
    allProviders,
    activeModel,
    availableToolNames,
    runtimeToolAvailability,
    toolCallHistory,
    signal,
    agentRunId: options.agentRunId,
    toolFilter: options.toolFilter,
    workspaceConversationId: options.workspaceConversationId,
    workspaceReadFallbackConversationId: options.workspaceReadFallbackConversationId,
    emitPendingAsyncOperationsChange,
    warn: (message, error) => {
      logger.devWarn(`${message}:`, error instanceof Error ? error.message : String(error));
    },
  });

  callbacks.onStateChange('thinking');
  try {
    await executeAgentControlGraphSession({
      allProviders,
      allTools,
      agentRunId: options.agentRunId,
      executionRunId: options.executionRunId,
      beforeEffectDispatch: options.beforeEffectDispatch,
      ...(mobileControllerRuntime
        ? {
            publishMobileControllerHandoff: async (persistedHandoff) => {
              const agentRunId = options.agentRunId?.trim();
              const publication = agentRunId
                ? buildMobileControllerPublishedHandoff(persistedHandoff, {
                    conversationId,
                    agentRunId,
                  })
                : null;
              if (!publication) {
                throw new Error('mobile_controller_handoff_publication_invalid');
              }
              await mobileControllerRuntime.persistGraphState();
              await mobileControllerRuntime.publishHandoff(publication);
            },
          }
        : {}),
      verifiedProcedureSession: verifiedProcedureSession ?? undefined,
      callbacks: graphCallbacks,
      compactionEngine,
      conversationId,
      disableTooling: options.disableTooling,
      emitPendingAsyncOperationsChange,
      failoverState,
      graph,
      initialRuntime: {
        activeModel,
        activeProvider,
        admittedMemoryContext,
        consecutivePendingAsyncNoToolTurns,
        lastPendingAsyncSignature,
        lastModelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        llm,
        warningInjectedThisRound,
        workingMessages,
      },
      isSuperAgent,
      isForegroundRun: options.isForegroundRun,
      runStartedAtMs: Date.now(),
      allowLongHorizonIterationExtensions,
      maxToolIterations,
      maxTokens,
      onCompaction: callbacks.onCompaction,
      onConversationModeEscalated: persistConversationModeEscalation,
      personaThinkingLevel: persona?.thinkingLevel,
      promptContextSupport: {
        graphGoals: graph.getGraphSnapshot().goals ?? [],
        maxToolIterations,
        resolvedPrompt,
        runtimeContext: runtimeContextNote,
        skillPrompts,
        workflowTaskAnchor,
      },
      reportUsage: (usage) => {
        callbacks.onUsage?.(usage);
        recordUsage(usageConversationId, usage);
      },
      requestFrame,
      refreshSessionMemoryContext: async (refreshInput) => {
        const graphSnapshot = refreshInput.graphSnapshot;
        const activeTaskId =
          graphSnapshot.activeTaskId ?? getActiveGoal(graphSnapshot.goals ?? [])?.id ?? taskId;
        const refreshedMemory = await loadOrchestratorMemoryAccessContext({
          activeModel: refreshInput.activeModel,
          activeProvider: refreshInput.activeProvider,
          asyncWork: graphSnapshot.asyncWork,
          goals: graphSnapshot.goals,
          internalUserMessageCount: memoryRefreshInternalUserMessages.length,
          startsAgentic,
          logger,
          memoryContextStrategy: options.memoryContextStrategy,
          memoryConversationId: sharedConversationId,
          memoryRetrievalStrategy: options.memoryRetrievalStrategy,
          messages: rebuildSessionMemoryRefreshMessages({
            internalUserMessages: memoryRefreshInternalUserMessages,
            workingMessages: refreshInput.workingMessages,
          }),
          personaId,
          sourceThreadId: conversationId,
          taskId: activeTaskId ?? null,
        });
        return {
          consistencyBarrier: refreshedMemory.consistencyBarrier,
          livingMemory: refreshedMemory.livingMemory,
        };
      },
      signal,
      temperature: persona?.temperature ?? temperature,
      thinkingLevel,
      toolRuntime: {
        availableToolNames,
        catalogVisibleToolNames,
        ...(currentUserMessage ? { currentUserMessage } : {}),
        memoryConversationId: sharedConversationId,
        runtimeToolAvailability,
        toolCallHistory,
        stagnationSignatures,
        explicitToolSurfaceToolNames,
        toolFilter: options.toolFilter,
        workspaceConversationId: options.workspaceConversationId,
        workspaceReadFallbackConversationId: options.workspaceReadFallbackConversationId,
        ...(mobileControllerRuntime ? { mobileController: mobileControllerRuntime.execution } : {}),
      },
      trackedAsyncOperations,
      warn: (message, error) => {
        logger.devWarn(`${message}:`, error instanceof Error ? error.message : String(error));
      },
      onFinalizationHeld: (details) => {
        if (isJestRuntime()) {
          return;
        }
        logger.warn('Graph finalization held:', {
          conversationId,
          iteration: details.iteration,
          holdReason: details.holdReason,
          missingRequiredEvidenceLabels: details.missingRequiredEvidenceLabels,
        });
      },
      yieldToUiFrame,
    });
  } catch {
    verifiedProcedureSession?.markReconciliationRequired();
  }

  const graphSnapshot = graph.getGraphSnapshot();
  let pendingVerifiedProcedureObservation: PendingVerifiedProcedureObservation | null = null;
  if (verifiedProcedureSession) {
    pendingVerifiedProcedureObservation = await verifiedProcedureSession.sealGraphCandidate({
      graphSnapshot,
      finalAssistant,
    });
  }
  const terminalDisposition: OrchestratorTerminalDisposition =
    graphSnapshot.status === 'awaiting_review'
      ? 'final_candidate'
      : graphSnapshot.status === 'yielded'
        ? 'yielded'
        : graphSnapshot.status === 'blocked'
          ? 'blocked'
          : graphSnapshot.status === 'cancelled'
            ? 'cancelled'
            : graphSnapshot.status === 'waiting_async'
              ? 'waiting'
              : graphSnapshot.status === 'awaiting_user'
                ? 'waiting'
                : 'failed';
  return {
    terminalDisposition,
    graphSnapshot,
    ...(pendingVerifiedProcedureObservation ? { pendingVerifiedProcedureObservation } : {}),
  };
}
