import type { AgentControlTurnDirectives } from '../agentControlGraph';
import { prepareAgentTurn } from '../agentTurnPreparation';
import type { PreparedAgentTurn } from '../agentTurnPreparation';
import type { PromptContextSupport } from '../prepareAgentControlGraphModelTurnTypes';
import type { ToolDefinition } from '../../../types/tool';
import type { Message } from '../../../types/message';
import { isMemoryReadEpochCurrent } from '../../../services/memory/policy';
import { messageMatchesWorkflowTaskAnchor } from '../workflowTaskAnchor';

export function buildPreparedModelTurnPrompt(params: {
  actionablePromptTurn: boolean;
  allowSessionCoordinationTools: boolean;
  effectiveForceTextReasonThisTurn?: AgentControlTurnDirectives['forcedTextReason'];
  effectiveForceTextThisTurn: boolean;
  groundedRequestScopedTools: ReadonlyArray<ToolDefinition>;
  iteration: number;
  pinnedToolNames: ReadonlyArray<string>;
  promptContextSupport: PromptContextSupport;
  toolingEnabledForProvider: boolean;
  workingMessages: ReadonlyArray<Message>;
}): PreparedAgentTurn {
  const memoryReadEpoch = params.promptContextSupport.livingMemoryReadEpoch;
  const livingMemorySections =
    memoryReadEpoch !== undefined && isMemoryReadEpochCurrent(memoryReadEpoch)
      ? params.promptContextSupport.livingMemorySections
      : undefined;
  const forcedConstraintGoals = (params.promptContextSupport.graphGoals ?? []).filter((goal) => {
    const live = goal.status === 'active' || goal.status === 'blocked' || goal.status === 'pending';
    return (
      (live &&
        (goal.userConstraintIntegrity === 'conflict' || (goal.userConstraints?.length ?? 0) > 0)) ||
      goal.userConstraintDeliveryPending === true
    );
  });
  const turnGraphGoals = params.actionablePromptTurn
    ? params.promptContextSupport.graphGoals
    : forcedConstraintGoals.length > 0
      ? forcedConstraintGoals
      : undefined;
  const workflowTaskAnchor = params.promptContextSupport.workflowTaskAnchor;
  const transcriptCarriesSoleFirstTurnAnchor =
    params.iteration === 1 &&
    params.workingMessages.length === 1 &&
    workflowTaskAnchor !== undefined &&
    messageMatchesWorkflowTaskAnchor(params.workingMessages[0], workflowTaskAnchor);
  const prepare = (sections: PromptContextSupport['livingMemorySections']) =>
    prepareAgentTurn({
      allowSessionCoordinationTools: params.allowSessionCoordinationTools,
      effectiveForceTextThisTurn: params.effectiveForceTextThisTurn,
      groundedRequestScopedTools: params.groundedRequestScopedTools,
      pinnedToolNames: params.pinnedToolNames,
      promptBundleContext: {
        effectiveForceTextReasonThisTurn: params.effectiveForceTextReasonThisTurn,
        graphGoals: turnGraphGoals,
        goalsPromptSection: params.actionablePromptTurn
          ? params.promptContextSupport.goalsPromptSection
          : null,
        groundedRequestScopedTools: params.groundedRequestScopedTools,
        iteration: params.iteration,
        livingMemorySections: params.actionablePromptTurn ? sections : undefined,
        maxToolIterations: params.promptContextSupport.maxToolIterations,
        resolvedPrompt: params.promptContextSupport.resolvedPrompt,
        runtimeContext: params.promptContextSupport.runtimeContext,
        skillPrompts: params.promptContextSupport.skillPrompts,
        workflowTaskAnchor: transcriptCarriesSoleFirstTurnAnchor
          ? undefined
          : workflowTaskAnchor,
      },
      toolingEnabledForProvider: params.toolingEnabledForProvider,
    });
  const preparedTurn = prepare(livingMemorySections);
  if (memoryReadEpoch === undefined) return preparedTurn;
  const memoryFreeTurn = prepare(undefined);
  return {
    ...preparedTurn,
    memoryReadFence: {
      readEpoch: memoryReadEpoch,
      memoryFreePrompt: {
        enrichedSystemPrompt: memoryFreeTurn.enrichedSystemPrompt,
        enrichedSystemPromptSections: memoryFreeTurn.enrichedSystemPromptSections,
      },
    },
  };
}
