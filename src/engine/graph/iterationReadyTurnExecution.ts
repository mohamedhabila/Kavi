import { LlmService } from '../../services/llm/LlmService';
import { bindProviderToModel } from '../../services/llm/support/providerSupport';
import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import { getPendingTrackedAsyncOperations } from '../pendingAsyncOperations';
import { getNextAvailableModel, recordFailure, recordSuccess } from '../failover';
import { hydrateProviderApiKey, shouldFailoverOnError } from '../orchestratorProviderRuntime';
import { executePreparedAgentControlGraphPendingToolTurn } from './iterationPendingToolExecution';
import { resolvePreparedAgentControlGraphModelTurnResult } from './iterationModelTurnResolution';
import { hasAgentControlGraphOneShotTurnDirectives } from './turnDirectives';
import { executeAgentControlGraphModelTurn, type PendingAgentToolCall } from './modelTurnExecution';
import type { PreparedAgentControlGraphModelTurnReady } from './prepareAgentControlGraphModelTurn';
import {
  buildMemoryRetrievalObservabilityDetail,
  buildToolSurfaceObservabilityDetail,
  GRAPH_OBSERVABILITY_AUDIT_TYPES,
} from './graphObservability';
import type {
  AgentControlGraphIterationRuntimeState,
  ExecuteAgentControlGraphIterationParams,
  ExecuteAgentControlGraphIterationResult,
} from './iterationExecutionTypes';

function buildResult(
  runtime: AgentControlGraphIterationRuntimeState,
  status: ExecuteAgentControlGraphIterationResult['status'],
): ExecuteAgentControlGraphIterationResult {
  return { runtime, status };
}

export async function executePreparedAgentControlGraphTurn(params: {
  iterationParams: ExecuteAgentControlGraphIterationParams;
  modelTurnPreparation: PreparedAgentControlGraphModelTurnReady;
  runtime: AgentControlGraphIterationRuntimeState;
}): Promise<ExecuteAgentControlGraphIterationResult> {
  const runtime = params.runtime;
  const iterationParams = params.iterationParams;
  const { preparedTurn, toolingEnabledForProvider } = params.modelTurnPreparation;
  const currentTurnDirectives = iterationParams.graph.getCurrentTurnDirectives();
  const consumeOneShotTurnDirectives =
    hasAgentControlGraphOneShotTurnDirectives(currentTurnDirectives);
  const { selectedToolTokenEstimate, selectedTools } = preparedTurn;

  if (toolingEnabledForProvider) {
    iterationParams.graph.recordPerformanceMetrics(
      {
        lastCandidateToolCount: selectedTools.length,
        lastActiveToolCount: selectedTools.length,
        maxActiveToolCount: selectedTools.length,
        lastActiveToolTokenEstimate: selectedToolTokenEstimate,
        maxActiveToolTokenEstimate: selectedToolTokenEstimate,
      },
      'active_tool_surface_selected',
    );
    iterationParams.graph.recordObservability({
      observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_SELECTED,
      iteration: iterationParams.iteration,
      detail: buildToolSurfaceObservabilityDetail({
        toolCount: selectedTools.length,
        toolNames: selectedTools.map((tool) => tool.name),
        tokenEstimate: selectedToolTokenEstimate,
      }),
    });
  }

  const livingMemory = iterationParams.livingMemory;
  if (livingMemory) {
    iterationParams.graph.recordObservability({
      observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.MEMORY_RETRIEVAL,
      iteration: iterationParams.iteration,
      detail: buildMemoryRetrievalObservabilityDetail({
        factCount: livingMemory.recalledFactCount,
        episodeCount: livingMemory.recalledEpisodeCount,
        sectionCount: livingMemory.sections.length,
      }),
    });
  }

  if (consumeOneShotTurnDirectives) {
    iterationParams.graph.consumeOneShotTurnDirectives('model_turn_started');
  }

  let fullContent = '';
  let reasoning = '';
  let providerReplay: MessageProviderReplay | undefined;
  let completion: AssistantCompletionMetadata | undefined;
  let pendingToolCalls: PendingAgentToolCall[] = [];
  let contextWindow = 0;
  let requestMaxTokens = params.modelTurnPreparation.requestMaxTokens;

  try {
    const modelTurnResult = await executeAgentControlGraphModelTurn({
      activeProvider: runtime.activeProvider,
      applyGraphEvents: iterationParams.graph.applyAgentControlGraphEvents,
      callbacks: {
        onAssistantStreamReset: iterationParams.callbacks.onAssistantStreamReset,
        onReasoning: iterationParams.callbacks.onReasoning,
        onStateChange: iterationParams.callbacks.onStateChange,
        onToken: iterationParams.callbacks.onToken,
        onToolCallQueued: iterationParams.callbacks.onToolCallQueued,
      },
      compactionEngine: iterationParams.compactionEngine,
      conversationId: iterationParams.conversationId,
      effectiveForceTextReasonThisTurn:
        params.modelTurnPreparation.effectiveForceTextReasonThisTurn,
      hasPendingAsyncOperations:
        getPendingTrackedAsyncOperations(iterationParams.trackedAsyncOperations).length > 0,
      iteration: iterationParams.iteration,
      livingMemory: iterationParams.livingMemory,
      llm: runtime.llm,
      onCompaction: iterationParams.onCompaction,
      preparedTurn,
      toolSurfacePinTelemetry: params.modelTurnPreparation.toolSurfacePinTelemetry,
      recordPerformanceMetrics: iterationParams.graph.recordPerformanceMetrics,
      reportUsage: iterationParams.reportUsage,
      requestMaxTokens,
      requestModel: params.modelTurnPreparation.requestModel,
      signal: iterationParams.signal,
      temperature: iterationParams.temperature,
      thinkingLevel: params.modelTurnPreparation.iterationThinkingLevel,
      warn: iterationParams.warn,
      workingMessages: runtime.workingMessages,
      yieldToUiFrame: iterationParams.yieldToUiFrame,
    });
    runtime.workingMessages = modelTurnResult.workingMessages;
    requestMaxTokens = modelTurnResult.requestMaxTokens;
    contextWindow = modelTurnResult.contextWindow;
    fullContent = modelTurnResult.fullContent;
    reasoning = modelTurnResult.reasoning;
    providerReplay = modelTurnResult.providerReplay;
    completion = modelTurnResult.completion;
    pendingToolCalls = modelTurnResult.pendingToolCalls;
    if (iterationParams.failoverState) {
      recordSuccess(
        iterationParams.failoverState,
        runtime.activeProvider.id,
        params.modelTurnPreparation.requestModel,
      );
    }
  } catch (streamError: unknown) {
    const streamErrorMsg = streamError instanceof Error ? streamError.message : String(streamError);
    if (
      iterationParams.failoverState &&
      streamErrorMsg !== 'Request cancelled' &&
      !iterationParams.signal?.signal.aborted &&
      shouldFailoverOnError(streamError)
    ) {
      recordFailure(
        iterationParams.failoverState,
        runtime.activeProvider.id,
        params.modelTurnPreparation.requestModel,
      );
      const next = getNextAvailableModel(iterationParams.failoverState);
      if (next && iterationParams.allProviders) {
        const nextProvider = iterationParams.allProviders.find(
          (provider) => provider.id === next.providerId,
        );
        if (nextProvider) {
          runtime.activeModel = next.model;
          runtime.activeProvider = bindProviderToModel(
            await hydrateProviderApiKey(nextProvider),
            runtime.activeModel,
          );
          runtime.llm = new LlmService(runtime.activeProvider);
          return buildResult(runtime, 'continued');
        }
      }
    }
    throw streamError instanceof Error ? streamError : new Error(String(streamError));
  }

  return buildResult(
    runtime,
    await resolvePreparedAgentControlGraphModelTurnResult({
      iterationParams,
      modelTurnPreparation: params.modelTurnPreparation,
      runtime,
      fullContent,
      reasoning,
      providerReplay,
      completion,
      pendingToolCalls,
      contextWindow,
      requestMaxTokens,
      executePendingToolTurn: (args) =>
        executePreparedAgentControlGraphPendingToolTurn({
          iterationParams,
          modelTurnPreparation: params.modelTurnPreparation,
          runtime,
          ...args,
        }),
    }),
  );
}
