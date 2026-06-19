import type { AgentControlTurnDirectives } from '../agentControlGraph';
import { prepareAgentTurn } from '../agentTurnPreparation';
import type { PreparedAgentTurn } from '../agentTurnPreparation';
import type { PromptContextSupport } from '../prepareAgentControlGraphModelTurnTypes';
import type { ToolDefinition } from '../../../types/tool';

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
}): PreparedAgentTurn {
  return prepareAgentTurn({
    allowSessionCoordinationTools: params.allowSessionCoordinationTools,
    effectiveForceTextThisTurn: params.effectiveForceTextThisTurn,
    groundedRequestScopedTools: params.groundedRequestScopedTools,
    pinnedToolNames: params.pinnedToolNames,
    promptBundleContext: {
      conversationMemory: params.actionablePromptTurn
        ? params.promptContextSupport.conversationMemory
        : null,
      effectiveForceTextReasonThisTurn: params.effectiveForceTextReasonThisTurn,
      globalMemory: params.promptContextSupport.globalMemory,
      graphGoals: params.actionablePromptTurn ? params.promptContextSupport.graphGoals : undefined,
      goalsPromptSection: params.actionablePromptTurn
        ? params.promptContextSupport.goalsPromptSection
        : null,
      groundedRequestScopedTools: params.groundedRequestScopedTools,
      iteration: params.iteration,
      livingMemorySections: params.actionablePromptTurn
        ? params.promptContextSupport.livingMemorySections
        : undefined,
      maxToolIterations: params.promptContextSupport.maxToolIterations,
      resolvedPrompt: params.promptContextSupport.resolvedPrompt,
      runtimeContext: params.promptContextSupport.runtimeContext,
      skillPrompts: params.promptContextSupport.skillPrompts,
    },
    toolingEnabledForProvider: params.toolingEnabledForProvider,
  });
}
