import { resolveProviderFamily } from '../../services/llm/catalog/providerFamilies';
import { buildPreparedModelTurnPrompt } from './modelTurn/buildPreparedPromptTurn';
import { resolveModelTurnGroundedToolSurface } from './modelTurn/resolveGroundedToolSurface';
import { resolveModelTurnIterationRequest } from './modelTurn/resolveIterationRequest';
import { buildWorkflowContinuationPrompt } from './workflowContinuationPrompt';
import type {
  PrepareAgentControlGraphModelTurnParams,
  PreparedAgentControlGraphModelTurnReady,
} from './prepareAgentControlGraphModelTurnTypes';

export type {
  PrepareAgentControlGraphModelTurnParams,
  PreparedAgentControlGraphModelTurnReady,
  PromptContextSupport,
} from './prepareAgentControlGraphModelTurnTypes';

export async function prepareAgentControlGraphModelTurn(
  params: PrepareAgentControlGraphModelTurnParams,
): Promise<PreparedAgentControlGraphModelTurnReady> {
  const iterationRequest = resolveModelTurnIterationRequest({
    activeModel: params.activeModel,
    activeProvider: params.activeProvider,
    disableTooling: params.disableTooling,
    iteration: params.iteration,
    maxTokens: params.maxTokens,
    personaThinkingLevel: params.personaThinkingLevel,
    thinkingLevel: params.thinkingLevel,
    turnDirectives: params.turnDirectives,
    workingMessages: params.workingMessages,
  });

  const toolSurface = await resolveModelTurnGroundedToolSurface({
    allTools: params.allTools,
    completedWorkflowToolNames: params.completedWorkflowToolNames,
    explicitToolSurfaceToolNames: params.explicitToolSurfaceToolNames,
    trackedAsyncOperations: params.trackedAsyncOperations,
    sessionActivatedToolNames: params.sessionActivatedToolNames,
    workingMessages: params.workingMessages,
  });

  const requestFamily = resolveProviderFamily(params.activeProvider);
  const preparedTurn = buildPreparedModelTurnPrompt({
    actionablePromptTurn: !iterationRequest.effectiveForceTextThisTurn,
    allTools: params.allTools,
    allowSessionCoordinationTools: toolSurface.allowSessionCoordinationTools,
    effectiveForceTextReasonThisTurn: iterationRequest.effectiveForceTextReasonThisTurn,
    effectiveForceTextThisTurn: iterationRequest.effectiveForceTextThisTurn,
    family: requestFamily,
    groundedRequestScopedTools: toolSurface.groundedRequestScopedTools,
    iteration: params.iteration,
    pinnedToolNames: toolSurface.pinnedToolNames,
    promptContextSupport: params.promptContextSupport,
    toolingEnabledForProvider: iterationRequest.toolingEnabledForProvider,
    workflowRuntimePrompt: buildWorkflowContinuationPrompt({
      allTools: params.allTools,
      completedToolNames: params.completedWorkflowToolNames,
      selectedToolNames: new Set(toolSurface.groundedRequestScopedTools.map((tool) => tool.name)),
    }),
    workingMessages: params.workingMessages,
  });

  return {
    effectiveForceTextThisTurn: iterationRequest.effectiveForceTextThisTurn,
    effectiveForceTextReasonThisTurn: iterationRequest.effectiveForceTextReasonThisTurn,
    iterationThinkingLevel: iterationRequest.iterationThinkingLevel,
    pendingAsyncMonitorToolNames: toolSurface.pendingAsyncMonitorToolNames,
    preparedTurn,
    requestMaxTokens: iterationRequest.requestMaxTokens,
    requestModel: iterationRequest.requestModel,
    toolingEnabledForProvider: iterationRequest.toolingEnabledForProvider,
    toolSurfacePinTelemetry: toolSurface.toolSurfacePinTelemetry,
  };
}
