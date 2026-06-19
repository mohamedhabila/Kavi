import { buildPreparedModelTurnPrompt } from './modelTurn/buildPreparedPromptTurn';
import { resolveModelTurnGroundedToolSurface } from './modelTurn/resolveGroundedToolSurface';
import { resolveModelTurnIterationRequest } from './modelTurn/resolveIterationRequest';
import type {
  PrepareAgentControlGraphModelTurnParams,
  PreparedAgentControlGraphModelTurnReady,
} from './prepareAgentControlGraphModelTurnTypes';

export type {
  LivingMemorySection,
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
    requestAction: params.requestAction,
    thinkingLevel: params.thinkingLevel,
    turnDirectives: params.turnDirectives,
    workingMessages: params.workingMessages,
  });

  const toolSurface = await resolveModelTurnGroundedToolSurface({
    allTools: params.allTools,
    completedWorkflowToolNames: params.completedWorkflowToolNames,
    goals: params.goals,
    useExplicitFilteredToolSurface: params.useExplicitFilteredToolSurface,
    trackedAsyncOperations: params.trackedAsyncOperations,
    sessionActivatedToolNames: params.sessionActivatedToolNames,
    workingMessages: params.workingMessages,
  });

  const preparedTurn = buildPreparedModelTurnPrompt({
    actionablePromptTurn: !iterationRequest.effectiveForceTextThisTurn,
    allowSessionCoordinationTools: toolSurface.allowSessionCoordinationTools,
    effectiveForceTextReasonThisTurn: iterationRequest.effectiveForceTextReasonThisTurn,
    effectiveForceTextThisTurn: iterationRequest.effectiveForceTextThisTurn,
    groundedRequestScopedTools: toolSurface.groundedRequestScopedTools,
    iteration: params.iteration,
    pinnedToolNames: toolSurface.pinnedToolNames,
    promptContextSupport: params.promptContextSupport,
    toolingEnabledForProvider: iterationRequest.toolingEnabledForProvider,
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
