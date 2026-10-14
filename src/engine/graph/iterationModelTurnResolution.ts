import { getEscalatedFinalizationMaxTokens } from '../../services/context/tokenOptimization';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import { mergeAssistantContinuationText } from '../orchestratorText';
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
  // Every call the model made runs and is answered: a provider rejects a history that leaves
  // one unanswered (Claude: "The final block in an assistant message cannot be `thinking`"
  // once the unanswered tool_use is stripped), and the model needs every result to go on.
  if (params.pendingToolCalls.length === 0) {
    const noToolTurnResolution = await resolveAgentControlGraphNoToolTurn({
      iteration: params.iterationParams.iteration,
      trackedAsyncOperations: params.iterationParams.trackedAsyncOperations,
      consecutivePendingAsyncNoToolTurns: params.runtime.consecutivePendingAsyncNoToolTurns,
      turnAssistantContent,
      modelTurnAssistantContent: params.fullContent,
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
      effectiveForceTextThisTurn: params.modelTurnPreparation.effectiveForceTextThisTurn,
      recoveryDirectives: params.iterationParams.graph.getCurrentTurnDirectives(),
      toolCallHistory: params.iterationParams.toolRuntime.toolCallHistory,
      nextFinalizationMaxTokens: getEscalatedFinalizationMaxTokens(
        params.requestMaxTokens,
        params.modelTurnPreparation.requestModel,
      ),
      workingMessages: params.runtime.workingMessages,
      commitModelTurn: () => {
        params.iterationParams.graph.applyAgentControlGraphEvents([
          {
            type: 'MODEL_TURN_COMPLETED',
            iteration: params.iterationParams.iteration,
            toolCalls: [],
          },
        ]);
      },
      applyGraphEvents: params.iterationParams.graph.applyAgentControlGraphEvents,
      resetIncompleteFinalTextRecovery:
        params.iterationParams.graph.resetIncompleteFinalTextRecovery,
      recordTurnDirectives: params.iterationParams.graph.recordTurnDirectives,
      finishWithGraphFinalCandidateEvent:
        params.iterationParams.graph.finishWithGraphFinalCandidateEvent,
      finishWithGraphTerminalEvent: params.iterationParams.graph.finishWithGraphTerminalEvent,
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
    pendingToolCalls: params.pendingToolCalls,
  });
}
