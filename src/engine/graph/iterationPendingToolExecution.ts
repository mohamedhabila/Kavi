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
import type { ModelTurnMemoryPolicyBinding } from '../authority/modelTurnMemoryPolicyBinding';
import { assertModelTurnMemoryPolicyBindingDurablyCurrent } from '../authority/modelTurnMemoryPolicyBinding';
import { attachModelTurnMemoryAttribution } from './modelTurnMemoryAttribution';

export async function executePreparedAgentControlGraphPendingToolTurn(params: {
  iterationParams: ExecuteAgentControlGraphIterationParams;
  modelTurnPreparation: PreparedAgentControlGraphModelTurnReady;
  runtime: AgentControlGraphIterationRuntimeState;
  contextWindow: number;
  memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  memoryRetrievalEventId?: string;
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
    currentUserMessage: params.iterationParams.toolRuntime.currentUserMessage,
    memoryConversationId: params.iterationParams.toolRuntime.memoryConversationId,
    workspaceConversationId: params.iterationParams.toolRuntime.workspaceConversationId,
    workspaceReadFallbackConversationId:
      params.iterationParams.toolRuntime.workspaceReadFallbackConversationId,
    availableToolNames: params.iterationParams.toolRuntime.availableToolNames,
    catalogVisibleToolNames: params.iterationParams.toolRuntime.catalogVisibleToolNames,
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
    memoryEvidenceToolDefinitions: params.iterationParams.allTools,
    getGraphSnapshot: params.iterationParams.graph.getGraphSnapshot,
    completedWorkflowToolNames: params.iterationParams.graph.completedWorkflowToolNames,
    lastPendingAsyncSignature: params.runtime.lastPendingAsyncSignature,
    contextWindow: params.contextWindow,
    compactionEngine: params.iterationParams.compactionEngine,
    livingMemory: params.runtime.admittedMemoryContext.livingMemory,
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
    finishWithGraphTerminalEvent: async (terminalParams) => {
      assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
      return params.iterationParams.graph.finishWithGraphTerminalEvent({
        ...terminalParams,
        assistantMetadata: attachModelTurnMemoryAttribution(
          terminalParams.assistantMetadata,
          params.memoryRetrievalEventId,
        ),
        beforeAssistantDelivery: () =>
          assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding),
      });
    },
    finishWaitingForUserInput: async (waitingParams) => {
      assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
      return params.iterationParams.graph.finishWaitingForUserInput({
        ...waitingParams,
        assistantMetadata: attachModelTurnMemoryAttribution(
          waitingParams.assistantMetadata,
          params.memoryRetrievalEventId,
        ),
        beforeAssistantDelivery: () =>
          assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding),
      });
    },
    recordPerformanceMetrics: params.iterationParams.graph.recordPerformanceMetrics,
    emitPendingAsyncOperationsChange: params.iterationParams.emitPendingAsyncOperationsChange,
    agentRunId: params.iterationParams.agentRunId,
    executionRunId: params.iterationParams.executionRunId,
    beforeEffectDispatch: params.iterationParams.beforeEffectDispatch,
    ...(params.iterationParams.toolRuntime.mobileController
      ? { mobileController: params.iterationParams.toolRuntime.mobileController }
      : {}),
    ...(params.iterationParams.publishMobileControllerHandoff
      ? {
          publishMobileControllerHandoff:
            params.iterationParams.publishMobileControllerHandoff,
        }
      : {}),
    verifiedProcedureSession: params.iterationParams.verifiedProcedureSession,
    warningInjectedThisRound: params.runtime.warningInjectedThisRound,
    turnAssistantContent: params.turnAssistantContent,
    reasoning: params.reasoning,
    providerReplay: params.providerReplay,
    completion: params.completion,
    pendingToolCalls: params.pendingToolCalls,
    memoryPolicyBinding: params.memoryPolicyBinding,
    workingMessages: params.runtime.workingMessages,
  });
  params.runtime.workingMessages = toolTurnExecution.workingMessages;
  params.runtime.lastPendingAsyncSignature = toolTurnExecution.lastPendingAsyncSignature;
  params.runtime.warningInjectedThisRound = toolTurnExecution.warningInjectedThisRound;
  return toolTurnExecution.status;
}
