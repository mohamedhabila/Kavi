import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import { getAgentControlGraphModelTurnBlocker } from './agentControlGraph';
import type {
  AgentControlGraphIterationRuntimeState,
  ExecuteAgentControlGraphIterationParams,
  ExecuteAgentControlGraphIterationResult,
} from './iterationExecutionTypes';
import type { PendingAgentToolCall } from './modelTurnExecution';
import type { PreparedAgentControlGraphModelTurnReady } from './prepareAgentControlGraphModelTurn';
import { executeAgentControlGraphToolTurn } from './toolTurnExecution';

export async function executePreparedAgentControlGraphPendingToolTurn(params: {
  iterationParams: ExecuteAgentControlGraphIterationParams;
  modelTurnPreparation: PreparedAgentControlGraphModelTurnReady;
  runtime: AgentControlGraphIterationRuntimeState;
  contextWindow: number;
  turnAssistantContent: string;
  reasoning: string;
  providerReplay?: MessageProviderReplay;
  completion?: AssistantCompletionMetadata;
  pendingToolCalls: ReadonlyArray<PendingAgentToolCall>;
}): Promise<ExecuteAgentControlGraphIterationResult['status']> {
  params.runtime.consecutivePendingAsyncNoToolTurns = 0;
  params.iterationParams.graph.resetIncompleteFinalTextRecovery('tool_execution_started');
  const toolTurnExecution = await executeAgentControlGraphToolTurn({
    iteration: params.iterationParams.iteration,
    maxToolIterations: params.iterationParams.maxToolIterations,
    conversationId: params.iterationParams.conversationId,
    activeProvider: params.runtime.activeProvider,
    allProviders: params.iterationParams.allProviders,
    activeModel: params.runtime.activeModel,
    workspaceConversationId: params.iterationParams.toolRuntime.workspaceConversationId,
    workspaceReadFallbackConversationId:
      params.iterationParams.toolRuntime.workspaceReadFallbackConversationId,
    availableToolNames: params.iterationParams.toolRuntime.availableToolNames,
    runtimeToolAvailability: params.iterationParams.toolRuntime.runtimeToolAvailability,
    toolCallHistory: params.iterationParams.toolRuntime.toolCallHistory,
    stagnationSignatures: params.iterationParams.toolRuntime.stagnationSignatures,
    trackedAsyncOperations: params.iterationParams.trackedAsyncOperations,
    signal: params.iterationParams.signal,
    callbacks: {
      onAssistantMessage: params.iterationParams.callbacks.onAssistantMessage,
      onToolCallStart: params.iterationParams.callbacks.onToolCallStart,
      onToolCallComplete: params.iterationParams.callbacks.onToolCallComplete,
      onToolMessage: params.iterationParams.callbacks.onToolMessage,
      onStateChange: params.iterationParams.callbacks.onStateChange,
    },
    toolFilter: params.iterationParams.toolRuntime.toolFilter,
    pendingAsyncMonitorToolNames: params.modelTurnPreparation.pendingAsyncMonitorToolNames,
    groundedRequestScopedTools: params.modelTurnPreparation.preparedTurn.selectedTools,
    getGraphSnapshot: params.iterationParams.graph.getGraphSnapshot,
    completedWorkflowToolNames: params.iterationParams.graph.completedWorkflowToolNames,
    lastPendingAsyncSignature: params.runtime.lastPendingAsyncSignature,
    contextWindow: params.contextWindow,
    compactionEngine: params.iterationParams.compactionEngine,
    livingMemory: params.iterationParams.livingMemory,
    onCompaction: params.iterationParams.onCompaction,
    warn: params.iterationParams.warn,
    yieldToUiFrame: params.iterationParams.yieldToUiFrame,
    applyGraphEvents: params.iterationParams.graph.applyAgentControlGraphEvents,
    publishWorkflowToolResultProgress:
      params.iterationParams.graph.publishWorkflowToolResultProgressToAgentControlGraph,
    syncPendingAsyncOperationsToGraph:
      params.iterationParams.graph.syncPendingAsyncOperationsToGraph,
    recordTurnDirectives: params.iterationParams.graph.recordTurnDirectives,
    recordPostToolFinalTextDirective: params.iterationParams.graph.recordPostToolFinalTextDirective,
    getModelTurnBlocker: () =>
      getAgentControlGraphModelTurnBlocker(params.iterationParams.graph.getGraphSnapshot()),
    finishWithGraphTerminalEvent: params.iterationParams.graph.finishWithGraphTerminalEvent,
    recordPerformanceMetrics: params.iterationParams.graph.recordPerformanceMetrics,
    emitPendingAsyncOperationsChange: params.iterationParams.emitPendingAsyncOperationsChange,
    warningInjectedThisRound: params.runtime.warningInjectedThisRound,
    turnAssistantContent: params.turnAssistantContent,
    reasoning: params.reasoning,
    providerReplay: params.providerReplay,
    completion: params.completion,
    pendingToolCalls: params.pendingToolCalls,
    workingMessages: params.runtime.workingMessages,
  });
  params.runtime.workingMessages = toolTurnExecution.workingMessages;
  params.runtime.lastPendingAsyncSignature = toolTurnExecution.lastPendingAsyncSignature;
  params.runtime.warningInjectedThisRound = toolTurnExecution.warningInjectedThisRound;
  return toolTurnExecution.status;
}
