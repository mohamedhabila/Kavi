import type { AgentControlTurnDirectives } from '../agentControlGraph';
import { prepareAgentTurn } from '../agentTurnPreparation';
import type { PreparedAgentTurn } from '../agentTurnPreparation';
import type { PromptContextSupport } from '../prepareAgentControlGraphModelTurnTypes';
import type { ToolDefinition } from '../../../types/tool';
import type { Message } from '../../../types/message';
import { captureMemoryReadEpoch, isMemoryReadEpochCurrent } from '../../../services/memory/policy';
import { messageMatchesWorkflowTaskAnchor } from '../workflowTaskAnchor';
import { buildMemoryPolicyPromptSection } from '../../prompts/memoryPolicyPrompt';
import {
  filterToolsForMemoryPolicy,
  isToolAllowedForMemoryPolicy,
} from '../../tools/memoryPolicyToolAuthority';

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
  const currentReadEpoch = captureMemoryReadEpoch();
  const longTermMemoryEnabled = currentReadEpoch !== null;
  const groundedRequestScopedTools = filterToolsForMemoryPolicy(
    params.groundedRequestScopedTools,
    longTermMemoryEnabled,
  );
  const hasCallableMemoryCapability =
    params.actionablePromptTurn &&
    params.toolingEnabledForProvider &&
    !params.effectiveForceTextThisTurn &&
    groundedRequestScopedTools.some((tool) => !isToolAllowedForMemoryPolicy(tool, false));
  const livingMemoryReadEpoch = params.promptContextSupport.livingMemoryReadEpoch;
  const livingMemoryReadCurrent =
    livingMemoryReadEpoch !== undefined && isMemoryReadEpochCurrent(livingMemoryReadEpoch);
  const memoryReadEpoch = livingMemoryReadCurrent
    ? livingMemoryReadEpoch
    : hasCallableMemoryCapability && currentReadEpoch !== null
      ? currentReadEpoch
      : undefined;
  const livingMemorySections = livingMemoryReadCurrent
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
  const prepare = (options: {
    groundedTools: ReadonlyArray<ToolDefinition>;
    longTermMemoryEnabled: boolean;
    pinnedTools: ReadonlyArray<string>;
    sections: PromptContextSupport['livingMemorySections'];
  }) =>
    prepareAgentTurn({
      allowSessionCoordinationTools: params.allowSessionCoordinationTools,
      effectiveForceTextThisTurn: params.effectiveForceTextThisTurn,
      groundedRequestScopedTools: options.groundedTools,
      pinnedToolNames: options.pinnedTools,
      promptBundleContext: {
        effectiveForceTextReasonThisTurn: params.effectiveForceTextReasonThisTurn,
        graphGoals: turnGraphGoals,
        goalsPromptSection: params.actionablePromptTurn
          ? params.promptContextSupport.goalsPromptSection
          : null,
        groundedRequestScopedTools: options.groundedTools,
        iteration: params.iteration,
        livingMemorySections: params.actionablePromptTurn ? options.sections : undefined,
        maxToolIterations: params.promptContextSupport.maxToolIterations,
        resolvedPrompt: params.promptContextSupport.resolvedPrompt,
        runtimeContext: params.promptContextSupport.runtimeContext,
        runtimePolicyPrompt: buildMemoryPolicyPromptSection(options.longTermMemoryEnabled),
        skillPrompts: params.promptContextSupport.skillPrompts,
        workflowTaskAnchor: transcriptCarriesSoleFirstTurnAnchor ? undefined : workflowTaskAnchor,
      },
      toolingEnabledForProvider: params.toolingEnabledForProvider,
    });
  const preparedTurn = prepare({
    groundedTools: groundedRequestScopedTools,
    longTermMemoryEnabled,
    pinnedTools: params.pinnedToolNames,
    sections: livingMemorySections,
  });
  if (memoryReadEpoch === undefined) return preparedTurn;
  const memoryFreeTurn = prepare({
    groundedTools: groundedRequestScopedTools,
    longTermMemoryEnabled: true,
    pinnedTools: params.pinnedToolNames,
    sections: undefined,
  });
  const memoryDisabledTools = filterToolsForMemoryPolicy(params.groundedRequestScopedTools, false);
  const memoryDisabledToolNames = new Set(memoryDisabledTools.map((tool) => tool.name));
  const memoryDisabledTurn = prepare({
    groundedTools: memoryDisabledTools,
    longTermMemoryEnabled: false,
    pinnedTools: params.pinnedToolNames.filter((name) => memoryDisabledToolNames.has(name)),
    sections: undefined,
  });
  return {
    ...preparedTurn,
    memoryReadFence: {
      readEpoch: memoryReadEpoch,
      memoryFreePrompt: {
        enrichedSystemPrompt: memoryFreeTurn.enrichedSystemPrompt,
        enrichedSystemPromptSections: memoryFreeTurn.enrichedSystemPromptSections,
      },
      memoryDisabledTurn,
    },
  };
}
