import { getPendingTrackedAsyncOperations } from '../pendingAsyncOperations';
import {
  appendRequestUnderstandingToRuntimeContext,
  areRequestUnderstandingSnapshotsEqual,
  projectRequestUnderstanding,
  renderRequestUnderstandingPromptSection,
  shouldRenderRequestUnderstandingPrompt,
  summarizeRequestUnderstanding,
} from '../../services/agents/requestUnderstandingProjection';
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
  const currentGoals = graphSnapshot.goals ?? [];
  const requestUnderstanding = projectRequestUnderstanding({
    requestFrame: params.requestFrame,
    goals: currentGoals,
  });
  const requestUnderstandingSnapshot = summarizeRequestUnderstanding(requestUnderstanding);
  if (
    !areRequestUnderstandingSnapshotsEqual(
      graphSnapshot.requestUnderstanding,
      requestUnderstandingSnapshot,
    )
  ) {
    params.graph.applyAgentControlGraphEvents([
      {
        type: 'REQUEST_UNDERSTANDING_PROJECTED',
        projection: requestUnderstandingSnapshot,
        iteration: params.iteration,
      },
    ]);
  }
  const requestUnderstandingPrompt = shouldRenderRequestUnderstandingPrompt({
    iteration: params.iteration,
    projection: requestUnderstanding,
  })
    ? renderRequestUnderstandingPromptSection(requestUnderstanding)
    : null;

  const modelTurnPreparation = await prepareAgentControlGraphModelTurn({
    activeModel: runtime.activeModel,
    activeProvider: runtime.activeProvider,
    allTools: params.allTools,
    disableTooling: params.disableTooling,
    completedWorkflowToolNames: params.graph.completedWorkflowToolNames,
    goals: currentGoals,
    useExplicitFilteredToolSurface: params.toolRuntime.useExplicitFilteredToolSurface,
    isSuperAgent: params.isSuperAgent,
    iteration: params.iteration,
    maxTokens: params.maxTokens,
    personaThinkingLevel: params.personaThinkingLevel,
    promptContextSupport: {
      ...params.promptContextSupport,
      graphGoals: currentGoals,
      runtimeContext: appendRequestUnderstandingToRuntimeContext(
        params.promptContextSupport.runtimeContext,
        requestUnderstandingPrompt,
      ),
    },
    requestFrame: params.requestFrame,
    thinkingLevel: params.thinkingLevel,
    trackedAsyncOperations: params.trackedAsyncOperations,
    turnDirectives: params.graph.getCurrentTurnDirectives(),
    sessionActivatedToolNames: params.graph.getGraphSnapshot().sessionActivatedToolNames,
    workingMessages: runtime.workingMessages,
    verifiedProcedureSession: params.verifiedProcedureSession,
  });

  return executePreparedAgentControlGraphTurn({
    iterationParams: params,
    modelTurnPreparation,
    runtime,
  });
}
