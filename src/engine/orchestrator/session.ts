import { DefaultContextEngine } from '../../services/context/compaction';
import { recordUsage } from '../../services/usage/tracker';
import { createLogger } from '../../utils/logger';
import { isJestRuntime } from '../../utils/runtime';

import { createOrchestratorGraphBindings } from '../graph/orchestratorGraphBindings';
import { resolveGraphEntryRequestDecision } from '../graph/requestDecisionSignals';
import { executeAgentControlGraphSession } from '../graph/sessionExecution';
import { prepareOrchestratorRequestBundle } from '../orchestratorRequestPreparation';
import { buildRuntimeContextNote } from '../prompts/orchestratorPromptSections';
import { yieldToUiFrame } from '../toolExecution/toolCallLifecycleRecording';
import { prepareOrchestratorSessionBootstrap } from './bootstrap';
import type { OrchestratorCallbacks, OrchestratorOptions } from './types';
import {
  resolveCodeOwnedMemoryConversationId,
  resolveCodeOwnedMemoryPersonaId,
} from '../../services/memory/memoryScopeIdentity';
import { buildRuntimeRequestDecisionToolAuthority } from './requestDecisionAuthority';
import { createMemoryAttributedOrchestratorCallbacks } from './memoryRetrievalAttribution';
import {
  createVerifiedProcedureExecutionSession,
  type PendingVerifiedProcedureObservation,
} from '../../services/memory/verifiedProcedure/executionSession';
import type { OrchestratorRunResult, OrchestratorTerminalDisposition } from './types';
import type { AssistantMessageMetadata } from '../../types/message';
import { resolveWorkflowTaskAnchor } from '../graph/workflowTaskAnchor';

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
    lastPendingAsyncSignature,
    llm,
    maxToolIterations,
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
    latestUserMessageText,
    livingMemory,
    requestFrame: structuralRequestFrame,
    skillPrompts,
    workingMessages,
  } = await prepareOrchestratorRequestBundle({
    activeModel,
    activeProvider,
    callbacks,
    conversationId,
    graphOwnedRun: isSuperAgent,
    internalUserMessageCount,
    isSuperAgent,
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
  const memoryAttributedCallbacks = createMemoryAttributedOrchestratorCallbacks({
    callbacks,
    livingMemory,
  });
  let finalAssistant:
    | Readonly<{ content: string; metadata?: AssistantMessageMetadata }>
    | undefined;
  const graphCallbacks = {
    ...memoryAttributedCallbacks,
    onAssistantMessage: (
      content: string,
      toolCalls?: Parameters<typeof memoryAttributedCallbacks.onAssistantMessage>[1],
      providerReplay?: Parameters<typeof memoryAttributedCallbacks.onAssistantMessage>[2],
      assistantMetadata?: AssistantMessageMetadata,
    ) => {
      if (assistantMetadata?.kind === 'final' && content.trim()) {
        finalAssistant = { content, metadata: assistantMetadata };
      }
      memoryAttributedCallbacks.onAssistantMessage(
        content,
        toolCalls,
        providerReplay,
        assistantMetadata,
      );
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
        consecutivePendingAsyncNoToolTurns,
        lastPendingAsyncSignature,
        llm,
        warningInjectedThisRound,
        workingMessages,
      },
      isSuperAgent,
      livingMemory,
      maxToolIterations,
      maxTokens,
      onCompaction: callbacks.onCompaction,
      personaThinkingLevel: persona?.thinkingLevel,
      promptContextSupport: {
        graphGoals: graph.getGraphSnapshot().goals ?? [],
        livingMemorySections: livingMemory?.sections,
        livingMemoryReadEpoch: livingMemory?.memoryReadEpoch,
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
        explicitToolSurfaceToolNames: options.explicitToolSurfaceToolNames,
        toolFilter: options.toolFilter,
        workspaceConversationId: options.workspaceConversationId,
        workspaceReadFallbackConversationId: options.workspaceReadFallbackConversationId,
      },
      trackedAsyncOperations,
      latestUserMessageText,
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
            : 'failed';
  return {
    terminalDisposition,
    graphSnapshot,
    ...(pendingVerifiedProcedureObservation ? { pendingVerifiedProcedureObservation } : {}),
  };
}
