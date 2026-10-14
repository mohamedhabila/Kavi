import type { AgentControlTurnDirectives } from '../agentControlGraph';
import { prepareAgentTurn } from '../agentTurnPreparation';
import type { PreparedAgentTurn } from '../agentTurnPreparation';
import type { PromptContextSupport } from '../prepareAgentControlGraphModelTurnTypes';
import type { ToolDefinition } from '../../../types/tool';
import type { Message } from '../../../types/message';
import { isLongTermMemoryEnabled } from '../../../services/memory/policy';
import { messageMatchesWorkflowTaskAnchor } from '../workflowTaskAnchor';
import { buildMemoryPolicyPromptSection } from '../../prompts/memoryPolicyPrompt';
import { renderPlanPromptSection } from '../../plan/agentPlan';
import { filterToolsForMemoryPolicy } from '../../tools/memoryPolicyToolAuthority';

export function buildPreparedModelTurnPrompt(params: {
  actionablePromptTurn: boolean;
  /** Full registry for this run; indexes capabilities that are not on the turn surface. */
  allTools?: ReadonlyArray<ToolDefinition>;
  allowSessionCoordinationTools: boolean;
  effectiveForceTextReasonThisTurn?: AgentControlTurnDirectives['forcedTextReason'];
  effectiveForceTextThisTurn: boolean;
  /** Provider family for the online token-calibration EMA (see `tokenCounter.ts`). */
  family?: string;
  groundedRequestScopedTools: ReadonlyArray<ToolDefinition>;
  iteration: number;
  pinnedToolNames: ReadonlyArray<string>;
  promptContextSupport: PromptContextSupport;
  toolingEnabledForProvider: boolean;
  workflowRuntimePrompt?: string | null;
  workingMessages: ReadonlyArray<Message>;
}): PreparedAgentTurn {
  const longTermMemoryEnabled = isLongTermMemoryEnabled();
  const memory = params.promptContextSupport.memory;
  // A read made while memory was on is not shown once it is turned off.
  const memorySection =
    memory?.status === 'read' && longTermMemoryEnabled ? memory.section?.text : undefined;
  const groundedRequestScopedTools = filterToolsForMemoryPolicy(
    params.groundedRequestScopedTools,
    longTermMemoryEnabled,
  );
  const groundedToolNames = new Set(groundedRequestScopedTools.map((tool) => tool.name));
  const policyAuthorizedPinnedToolNames = params.pinnedToolNames.filter((name) =>
    groundedToolNames.has(name),
  );
  // The anchor keeps the exact request in view once compaction has dropped it from the
  // transcript. While the transcript still carries it, a copy only adds tokens, and adding it
  // from the second iteration on changed the prompt's uncached tail mid-turn, so every tool
  // loop re-processed the turn at full price.
  const workflowTaskAnchor = params.promptContextSupport.workflowTaskAnchor;
  const transcriptCarriesAnchor =
    workflowTaskAnchor !== undefined &&
    params.workingMessages.some((message) =>
      messageMatchesWorkflowTaskAnchor(message, workflowTaskAnchor),
    );
  const prepare = (options: {
    groundedTools: ReadonlyArray<ToolDefinition>;
    longTermMemoryEnabled: boolean;
    pinnedTools: ReadonlyArray<string>;
    memorySection: string | undefined;
  }) =>
    prepareAgentTurn({
      allowSessionCoordinationTools: params.allowSessionCoordinationTools,
      effectiveForceTextThisTurn: params.effectiveForceTextThisTurn,
      family: params.family,
      groundedRequestScopedTools: options.groundedTools,
      pinnedToolNames: options.pinnedTools,
      promptBundleContext: {
        allTools: params.allTools,
        effectiveForceTextReasonThisTurn: params.effectiveForceTextReasonThisTurn,
        groundedRequestScopedTools: options.groundedTools,
        iteration: params.iteration,
        memorySection: params.actionablePromptTurn ? options.memorySection : undefined,
        maxToolIterations: params.promptContextSupport.maxToolIterations,
        planPromptSection: params.actionablePromptTurn
          ? renderPlanPromptSection(params.promptContextSupport.graphPlan)
          : null,
        resolvedPrompt: params.promptContextSupport.resolvedPrompt,
        runtimeContext: params.promptContextSupport.runtimeContext,
        runtimePolicyPrompt: buildMemoryPolicyPromptSection(options.longTermMemoryEnabled),
        skillPrompts: params.promptContextSupport.skillPrompts,
        workflowRuntimePrompt: params.workflowRuntimePrompt,
        workflowTaskAnchor: transcriptCarriesAnchor ? undefined : workflowTaskAnchor,
      },
      toolingEnabledForProvider: params.toolingEnabledForProvider,
    });
  return prepare({
    groundedTools: groundedRequestScopedTools,
    longTermMemoryEnabled,
    pinnedTools: policyAuthorizedPinnedToolNames,
    memorySection,
  });
}
