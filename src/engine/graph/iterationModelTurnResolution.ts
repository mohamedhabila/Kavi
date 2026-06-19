import { getEscalatedFinalizationMaxTokens } from '../../services/context/tokenOptimization';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import { mergeAssistantContinuationText } from '../orchestratorText';
import { trimAgentControlGraphPendingToolCallsAfterYield } from './sessionsYield';
import { selectOneShotDiscoveryToolCalls } from './discoveryToolActivation';
import { resolveAgentControlGraphNoToolTurn } from './noToolTurnResolution';
import type {
  AgentControlGraphIterationRuntimeState,
  ExecuteAgentControlGraphIterationParams,
  ExecuteAgentControlGraphIterationResult,
} from './iterationExecutionTypes';
import type { PendingAgentToolCall } from './modelTurnExecution';
import type { PreparedAgentControlGraphModelTurnReady } from './prepareAgentControlGraphModelTurn';

export async function resolvePreparedAgentControlGraphModelTurnResult(params: {
  iterationParams: ExecuteAgentControlGraphIterationParams;
  modelTurnPreparation: PreparedAgentControlGraphModelTurnReady;
  runtime: AgentControlGraphIterationRuntimeState;
  fullContent: string;
  reasoning: string;
  providerReplay?: MessageProviderReplay;
  completion?: AssistantCompletionMetadata;
  pendingToolCalls: PendingAgentToolCall[];
  contextWindow: number;
  requestMaxTokens: number;
  executePendingToolTurn: (args: {
    contextWindow: number;
    turnAssistantContent: string;
    reasoning: string;
    providerReplay?: MessageProviderReplay;
    completion?: AssistantCompletionMetadata;
    pendingToolCalls: ReadonlyArray<PendingAgentToolCall>;
  }) => Promise<ExecuteAgentControlGraphIterationResult['status']>;
}): Promise<ExecuteAgentControlGraphIterationResult['status']> {
  const continuationPrefix =
    params.iterationParams.graph.getCurrentTurnDirectives().incompleteFinalTextContinuationPrefix;
  const turnAssistantContent = continuationPrefix
    ? mergeAssistantContinuationText(continuationPrefix, params.fullContent)
    : params.fullContent;
  const executableToolCalls = selectOneShotDiscoveryToolCalls(
    trimAgentControlGraphPendingToolCallsAfterYield(params.pendingToolCalls),
  );
  params.iterationParams.graph.applyAgentControlGraphEvents([
    {
      type: 'MODEL_TURN_COMPLETED',
      iteration: params.iterationParams.iteration,
      toolCalls: executableToolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
      })),
    },
  ]);

  if (executableToolCalls.length === 0) {
    const noToolTurnResolution = await resolveAgentControlGraphNoToolTurn({
      iteration: params.iterationParams.iteration,
      trackedAsyncOperations: params.iterationParams.trackedAsyncOperations,
      consecutivePendingAsyncNoToolTurns: params.runtime.consecutivePendingAsyncNoToolTurns,
      turnAssistantContent,
      reasoning: params.reasoning,
      providerReplay: params.providerReplay,
      completion: params.completion,
      controlGraph: params.iterationParams.graph.getGraphSnapshot(),
      toolingEnabledForProvider: params.modelTurnPreparation.toolingEnabledForProvider,
      selectedToolCount: params.modelTurnPreparation.preparedTurn.selectedTools.length,
      selectedToolNames: new Set(
        params.modelTurnPreparation.preparedTurn.selectedTools
          .map((tool) => normalizeToolName(tool.name))
          .filter(Boolean),
      ),
      selectedTools: params.modelTurnPreparation.preparedTurn.selectedTools,
      effectiveForceTextThisTurn: params.modelTurnPreparation.effectiveForceTextThisTurn,
      recoveryDirectives: params.iterationParams.graph.getCurrentTurnDirectives(),
      toolCallHistory: params.iterationParams.toolRuntime.toolCallHistory,
      nextFinalizationMaxTokens: getEscalatedFinalizationMaxTokens(
        params.requestMaxTokens,
        params.modelTurnPreparation.requestModel,
      ),
      workingMessages: params.runtime.workingMessages,
      applyGraphEvents: params.iterationParams.graph.applyAgentControlGraphEvents,
      resetIncompleteFinalTextRecovery:
        params.iterationParams.graph.resetIncompleteFinalTextRecovery,
      recordTurnDirectives: params.iterationParams.graph.recordTurnDirectives,
      finishWithGraphFinalCandidateEvent:
        params.iterationParams.graph.finishWithGraphFinalCandidateEvent,
      onContinueThinking: async () => {
        params.iterationParams.callbacks.onStateChange('thinking');
        await params.iterationParams.yieldToUiFrame();
      },
      onFinalizationHeld: params.iterationParams.onFinalizationHeld,
    });
    if (noToolTurnResolution.status === 'finalized') {
      return 'finalized';
    }
    params.runtime.consecutivePendingAsyncNoToolTurns =
      noToolTurnResolution.nextConsecutivePendingAsyncNoToolTurns;
    return 'continued';
  }

  return params.executePendingToolTurn({
    contextWindow: params.contextWindow,
    turnAssistantContent,
    reasoning: params.reasoning,
    providerReplay: params.providerReplay,
    completion: params.completion,
    pendingToolCalls: executableToolCalls,
  });
}
