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
import {
  assertModelTurnMemoryPolicyBindingCurrent,
  assertModelTurnMemoryPolicyBindingDurablyCurrent,
  type ModelTurnMemoryPolicyBinding,
} from '../authority/modelTurnMemoryPolicyBinding';
import { attachModelTurnMemoryAttribution } from './modelTurnMemoryAttribution';

export async function resolvePreparedAgentControlGraphModelTurnResult(params: {
  iterationParams: ExecuteAgentControlGraphIterationParams;
  modelTurnPreparation: PreparedAgentControlGraphModelTurnReady;
  runtime: AgentControlGraphIterationRuntimeState;
  fullContent: string;
  memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  memoryRetrievalEventId?: string;
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
    memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  }) => Promise<ExecuteAgentControlGraphIterationResult['status']>;
}): Promise<ExecuteAgentControlGraphIterationResult['status']> {
  assertModelTurnMemoryPolicyBindingCurrent(params.memoryPolicyBinding);
  let modelTurnCommitted = false;
  const continuationPrefix =
    params.iterationParams.graph.getCurrentTurnDirectives().incompleteFinalTextContinuationPrefix;
  const turnAssistantContent = continuationPrefix
    ? mergeAssistantContinuationText(continuationPrefix, params.fullContent)
    : params.fullContent;
  const executableToolCalls = selectOneShotDiscoveryToolCalls(
    trimAgentControlGraphPendingToolCallsAfterYield(params.pendingToolCalls),
  );
  if (executableToolCalls.length === 0) {
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
        assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
        params.iterationParams.graph.applyAgentControlGraphEvents([
          {
            type: 'MODEL_TURN_COMPLETED',
            iteration: params.iterationParams.iteration,
            toolCalls: [],
          },
        ]);
        modelTurnCommitted = true;
      },
      applyGraphEvents: params.iterationParams.graph.applyAgentControlGraphEvents,
      resetIncompleteFinalTextRecovery:
        params.iterationParams.graph.resetIncompleteFinalTextRecovery,
      recordTurnDirectives: params.iterationParams.graph.recordTurnDirectives,
      finishWithGraphFinalCandidateEvent: async (finalParams) => {
        assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
        return params.iterationParams.graph.finishWithGraphFinalCandidateEvent({
          ...finalParams,
          assistantMetadata: attachModelTurnMemoryAttribution(
            finalParams.assistantMetadata,
            params.memoryRetrievalEventId,
          ),
          beforeAssistantDelivery: () =>
            assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding),
        });
      },
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
      onContinueThinking: async () => {
        assertModelTurnMemoryPolicyBindingCurrent(params.memoryPolicyBinding);
        params.iterationParams.callbacks.onStateChange('thinking');
        await params.iterationParams.yieldToUiFrame();
        assertModelTurnMemoryPolicyBindingCurrent(params.memoryPolicyBinding);
      },
      onFinalizationHeld: params.iterationParams.onFinalizationHeld,
    });
    if (noToolTurnResolution.status === 'finalized') {
      return 'finalized';
    }
    if (!modelTurnCommitted) {
      assertModelTurnMemoryPolicyBindingCurrent(params.memoryPolicyBinding);
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
    memoryPolicyBinding: params.memoryPolicyBinding,
    pendingToolCalls: executableToolCalls,
  });
}
