import { DefaultCompactionEngine } from '../../services/context/compaction';
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
import { buildRuntimeRequestDecisionToolAuthority } from './requestDecisionAuthority';
import type { OrchestratorRunResult, OrchestratorTerminalDisposition } from './types';
import { resolveWorkflowTaskAnchor } from '../graph/workflowTaskAnchor';
import { rebuildSessionMemoryRefreshMessages } from './sessionMemoryRefreshMessages';
import { buildMobileControllerPublishedHandoff } from '../mobileController/publication';
import { resolveRuntimeExplicitToolSurfaceToolNames } from '../tools/runtimeAvailability';
import { settleToolCallOutcome } from '../../services/llm/support/upstreamHealth';

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

  const availableToolNames = new Set(allTools.map((tool) => tool.name));
  const explicitToolSurfaceToolNames = resolveRuntimeExplicitToolSurfaceToolNames(
    options.explicitToolSurfaceToolNames,
    runtimeToolAvailability,
  );
  const compactionEngine = enableCompaction ? new DefaultCompactionEngine() : null;
  const sharedConversationId = options.memoryConversationId ?? conversationId;
  const runtimeContextNote = buildRuntimeContextNote();
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
    // The anchor protects task fidelity across long, delegation-capable execution; a
    // plain interactive turn that cannot delegate does not need it. A run
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
    memory,
    memoryRefreshInternalUserMessages,
    requestFrame: structuralRequestFrame,
    skillPrompts,
    workingMessages,
  } = await prepareOrchestratorRequestBundle({
    activeModel,
    activeProvider,
    callbacks,
    conversationId,
    internalUserMessageCount,
    linkUnderstandingEnabled,
    logger,
    maxLinks,
    mediaUnderstandingEnabled,
    memoryConversationId: sharedConversationId,
    messages: options.messages,
    workflowScopeUserMessageId: options.workflowScopeUserMessageId,
    graphSnapshot: options.initialAgentControlGraphState,
  });
  callbacks.onTurnLatencyMark?.('request_context_prepared');
  const requestFrame = resolveGraphEntryRequestDecision({
    frame: structuralRequestFrame,
    graphSnapshot: options.initialAgentControlGraphState,
    toolAuthority: buildRuntimeRequestDecisionToolAuthority(availableToolNames),
  });
  const graphCallbacks = {
    ...callbacks,
    onToolCallComplete: (toolCall: Parameters<typeof callbacks.onToolCallComplete>[0]) => {
      settleToolCallOutcome(toolCall);
      callbacks.onToolCallComplete(toolCall);
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
        memory,
        consecutivePendingAsyncNoToolTurns,
        lastPendingAsyncSignature,
        llm,
        warningInjectedThisRound,
        workingMessages,
      },
      isForegroundRun: options.isForegroundRun,
      allowLongHorizonIterationExtensions,
      maxToolIterations,
      maxTokens,
      onCompaction: callbacks.onCompaction,
      personaThinkingLevel: persona?.thinkingLevel,
      promptContextSupport: {
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
      refreshSessionMemory: (workingMessages) =>
        loadOrchestratorMemoryAccessContext({
          internalUserMessageCount: memoryRefreshInternalUserMessages.length,
          logger,
          memoryConversationId: sharedConversationId,
          messages: rebuildSessionMemoryRefreshMessages({
            internalUserMessages: memoryRefreshInternalUserMessages,
            workingMessages,
          }),
        }).memory,
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
    // The session has already recorded the failure in the graph (finishFailure); the
    // terminal disposition below reports it from the graph snapshot.
  }

  const graphSnapshot = graph.getGraphSnapshot();
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
  return { terminalDisposition, graphSnapshot };
}
