import { getPendingTrackedAsyncOperations } from '../pendingAsyncOperations';
import { prepareAgentControlGraphModelTurn } from './prepareAgentControlGraphModelTurn';
import { executePreparedAgentControlGraphTurn } from './iterationReadyTurnExecution';
import type {
  AgentControlGraphIterationRuntimeState,
  ExecuteAgentControlGraphIterationParams,
} from './iterationExecutionTypes';

export async function executeAgentControlGraphIteration(
  params: ExecuteAgentControlGraphIterationParams,
) {
  const runtime: AgentControlGraphIterationRuntimeState = {
    ...params.runtime,
    workingMessages: [...params.runtime.workingMessages],
  };

  if (!params.graph.getCurrentTurnDirectives().forceFinalText) {
    params.graph.recordPostToolFinalTextDirective({
      pendingAsyncCount: getPendingTrackedAsyncOperations(params.trackedAsyncOperations).length,
    });
  }

  const graphSnapshot = params.graph.getGraphSnapshot();
  const modelTurnPreparation = await prepareAgentControlGraphModelTurn({
    activeModel: runtime.activeModel,
    activeProvider: runtime.activeProvider,
    allTools: params.allTools,
    disableTooling: params.disableTooling,
    completedWorkflowToolNames: params.graph.completedWorkflowToolNames,
    explicitToolSurfaceToolNames: params.toolRuntime.explicitToolSurfaceToolNames,
    iteration: params.iteration,
    maxTokens: params.maxTokens,
    personaThinkingLevel: params.personaThinkingLevel,
    promptContextSupport: {
      ...params.promptContextSupport,
      graphPlan: graphSnapshot.plan,
      memory: runtime.memory,
    },
    thinkingLevel: params.thinkingLevel,
    trackedAsyncOperations: params.trackedAsyncOperations,
    turnDirectives: params.graph.getCurrentTurnDirectives(),
    sessionActivatedToolNames: params.graph.getGraphSnapshot().sessionActivatedToolNames,
    workingMessages: runtime.workingMessages,
  });

  return executePreparedAgentControlGraphTurn({
    iterationParams: params,
    modelTurnPreparation,
    runtime,
  });
}
