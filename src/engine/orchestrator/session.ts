import { DefaultContextEngine } from '../../services/context/compaction';
import { recordUsage } from '../../services/usage/tracker';
import { createLogger } from '../../utils/logger';
import { isJestRuntime } from '../../utils/runtime';

import { createOrchestratorGraphBindings } from '../graph/orchestratorGraphBindings';
import { executeAgentControlGraphSession } from '../graph/sessionExecution';
import { prepareOrchestratorRequestBundle } from '../orchestratorRequestPreparation';
import { buildRuntimeContextNote } from '../prompts/orchestratorPromptSections';
import { yieldToUiFrame } from '../toolExecution/toolCallLifecycleRecording';
import { prepareOrchestratorSessionBootstrap } from './bootstrap';
import type { OrchestratorCallbacks, OrchestratorOptions } from './types';

const logger = createLogger('Orchestrator');

export async function runOrchestratorGraphSession(params: {
  options: OrchestratorOptions;
  callbacks: OrchestratorCallbacks;
  sessionBootstrap: Awaited<ReturnType<typeof prepareOrchestratorSessionBootstrap>>;
}): Promise<void> {
  const { options, callbacks, sessionBootstrap } = params;
  const {
    activeModel,
    activeProvider,
    allTools,
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
    personaId,
    allProviders,
  } = options;

  const availableToolNames = new Set(allTools.map((tool) => tool.name));
  const compactionEngine = enableCompaction ? new DefaultContextEngine() : null;
  const sharedConversationId = options.workspaceConversationId?.trim() || conversationId;
  const runtimeContextNote = buildRuntimeContextNote();

  const {
    latestUserMessageText,
    livingMemory,
    requestAssessment,
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
    taskId: options.taskId,
    workflowScopeUserMessageId: options.workflowScopeUserMessageId,
    graphSnapshot: options.initialAgentControlGraphState,
  });

  const graph = createOrchestratorGraphBindings({
    callbacks,
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
    toolFilter: options.toolFilter,
    workspaceConversationId: options.workspaceConversationId,
    workspaceReadFallbackConversationId: options.workspaceReadFallbackConversationId,
    emitPendingAsyncOperationsChange,
    warn: (message, error) => {
      logger.devWarn(
        `${message}:`,
        error instanceof Error ? error.message : String(error),
      );
    },
  });

  callbacks.onStateChange('thinking');
  try {
    await executeAgentControlGraphSession({
      allProviders,
      allTools,
      callbacks,
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
        conversationMemory: null,
        globalMemory: null,
        graphGoals: graph.getGraphSnapshot().goals ?? [],
        livingMemorySections: livingMemory?.sections,
        maxToolIterations,
        resolvedPrompt,
        runtimeContext: runtimeContextNote,
        skillPrompts,
      },
      reportUsage: (usage) => {
        callbacks.onUsage?.(usage);
        recordUsage(usageConversationId, usage);
      },
      requestAction: requestAssessment.action,
      signal,
      temperature: persona?.temperature ?? temperature,
      thinkingLevel,
      toolRuntime: {
        availableToolNames,
        runtimeToolAvailability,
        toolCallHistory,
        stagnationSignatures,
        useExplicitFilteredToolSurface: Boolean(options.toolFilter),
        toolFilter: options.toolFilter,
        workspaceConversationId: options.workspaceConversationId,
        workspaceReadFallbackConversationId: options.workspaceReadFallbackConversationId,
      },
      trackedAsyncOperations,
      latestUserMessageText,
      warn: (message, error) => {
        logger.devWarn(
          `${message}:`,
          error instanceof Error ? error.message : String(error),
        );
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
    return;
  }
}
