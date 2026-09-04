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
import { buildConversationModeEscalationDetail } from './conversation/modeEscalation';
import { resolveConversationStartsAgentic } from './conversation/resolveConversationRuntimeMode';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from './graphObservability';
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
  const livingMemory = runtime.admittedMemoryContext.livingMemory;

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
    explicitToolSurfaceToolNames: params.toolRuntime.explicitToolSurfaceToolNames,
    // Downstream this flag only decides the turn's starting conversation mode
    // ('agentic' vs 'chitchat'); mode is a conversation property, not a persona flag,
    // so read the conversation's own persisted mode here instead of re-deriving it
    // from the persona. `escalatedToAgentic` still carries a same-run escalation
    // forward even before the persisted write below is visible to a re-read.
    startsAgentic: resolveConversationStartsAgentic({
      conversationId: params.conversationId,
      personaIsSuperAgent: params.isSuperAgent,
    }),
    escalatedToAgentic: runtime.escalatedToAgentic === true,
    iteration: params.iteration,
    maxTokens: params.maxTokens,
    personaThinkingLevel: params.personaThinkingLevel,
    promptContextSupport: {
      ...params.promptContextSupport,
      graphGoals: currentGoals,
      livingMemorySections: livingMemory?.sections,
      livingMemoryReadEpoch: livingMemory?.memoryReadEpoch,
      livingMemoryAuthoritySnapshot: livingMemory?.memoryAuthoritySnapshot,
      livingMemoryValidUntil: livingMemory?.validUntil,
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

  // A chitchat turn that reached for agentic-only capability escalates the whole
  // conversation rather than silently dropping the tool. The current iteration keeps
  // the surface it already resolved; authority applies from the next one, and the
  // persisted mode carries it into later user turns.
  // Absent detection means "no escalation", never a crash: escalation is an optional
  // signal layered onto turn preparation, and a turn must still execute without it.
  const modeEscalation = modelTurnPreparation.modeEscalation;
  if (modeEscalation?.required === true && runtime.escalatedToAgentic !== true) {
    runtime.escalatedToAgentic = true;
    params.graph.recordObservability({
      observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.CONVERSATION_MODE_ESCALATED,
      iteration: params.iteration,
      detail: buildConversationModeEscalationDetail(modeEscalation),
    });
    params.onConversationModeEscalated?.({
      conversationId: params.conversationId,
      reason: modeEscalation.reason,
      blockedToolNames: modeEscalation.blockedToolNames,
    });
  }

  return executePreparedAgentControlGraphTurn({
    iterationParams: params,
    modelTurnPreparation,
    runtime,
  });
}
