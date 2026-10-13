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
import { evaluateForegroundInteractionBudgetCheckpoint } from './foregroundRun/foregroundInteractionBudget';
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

  // A foreground interactive run is bounded far tighter than a background or
  // delegated-worker run: reaching the iteration or wall-clock ceiling forces a
  // text-only checkpoint turn instead of continuing to call tools, and the run
  // ends as a clean, resumable turn rather than grinding on unseen. This check
  // takes precedence over the ordinary post-tool final-text directive below, and
  // fires at most once per run (`runtime.foregroundCheckpointed`); a model-turn
  // inactivity timeout can also arm it once (see iterationReadyTurnExecution.ts).
  const foregroundCheckpoint = evaluateForegroundInteractionBudgetCheckpoint({
    isForegroundRun: params.isForegroundRun === true,
    iteration: params.iteration,
    elapsedMs: Date.now() - (params.runStartedAtMs ?? Date.now()),
    alreadyCheckpointedThisRun: runtime.foregroundCheckpointed === true,
  });
  if (foregroundCheckpoint.shouldCheckpoint) {
    runtime.foregroundCheckpointed = true;
    params.graph.recordTurnDirectives(
      { forceFinalText: true, forcedTextReason: 'foreground_budget_checkpoint' },
      foregroundCheckpoint.reason ?? 'foreground_interaction_budget',
    );
  } else if (!params.graph.getCurrentTurnDirectives().forceFinalText) {
    params.graph.recordPostToolFinalTextDirective({
      pendingAsyncCount: getPendingTrackedAsyncOperations(params.trackedAsyncOperations).length,
    });
  }

  const graphSnapshot = params.graph.getGraphSnapshot();
  const requestUnderstanding = projectRequestUnderstanding({ requestFrame: params.requestFrame });
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
    explicitToolSurfaceToolNames: params.toolRuntime.explicitToolSurfaceToolNames,
    iteration: params.iteration,
    maxTokens: params.maxTokens,
    personaThinkingLevel: params.personaThinkingLevel,
    promptContextSupport: {
      ...params.promptContextSupport,
      graphPlan: graphSnapshot.plan,
      memory: runtime.memory,
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
  });

  return executePreparedAgentControlGraphTurn({
    iterationParams: params,
    modelTurnPreparation,
    runtime,
  });
}
