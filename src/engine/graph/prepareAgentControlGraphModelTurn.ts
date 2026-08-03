import { buildPreparedModelTurnPrompt } from './modelTurn/buildPreparedPromptTurn';
import { appendVerifiedProcedureAdvisoryPrompt } from './modelTurn/verifiedProcedureAdvisoryPrompt';
import { resolveModelTurnGroundedToolSurface } from './modelTurn/resolveGroundedToolSurface';
import { resolveModelTurnIterationRequest } from './modelTurn/resolveIterationRequest';
import { buildWorkflowContinuationPrompt } from './workflowContinuationPrompt';
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
    requestFrame: params.requestFrame,
    thinkingLevel: params.thinkingLevel,
    turnDirectives: params.turnDirectives,
    workingMessages: params.workingMessages,
  });

  const toolSurface = await resolveModelTurnGroundedToolSurface({
    allTools: params.allTools,
    // A run that has already escalated keeps agentic authority for its remaining
    // iterations; the persisted conversation mode carries it into later turns.
    conversationMode: params.isSuperAgent || params.escalatedToAgentic ? 'agentic' : 'chitchat',
    completedWorkflowToolNames: params.completedWorkflowToolNames,
    goals: params.goals,
    explicitToolSurfaceToolNames: params.explicitToolSurfaceToolNames,
    trackedAsyncOperations: params.trackedAsyncOperations,
    sessionActivatedToolNames: params.sessionActivatedToolNames,
    workingMessages: params.workingMessages,
  });

  const basePreparedTurn = buildPreparedModelTurnPrompt({
    actionablePromptTurn: !iterationRequest.effectiveForceTextThisTurn,
    allTools: params.allTools,
    allowSessionCoordinationTools: toolSurface.allowSessionCoordinationTools,
    effectiveForceTextReasonThisTurn: iterationRequest.effectiveForceTextReasonThisTurn,
    effectiveForceTextThisTurn: iterationRequest.effectiveForceTextThisTurn,
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
  const preparedTurn = await appendVerifiedProcedureAdvisoryPrompt(
    basePreparedTurn,
    params.verifiedProcedureSession,
  );

  return {
    modeEscalation: toolSurface.modeEscalation,
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
