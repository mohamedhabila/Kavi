import type { AgentControlTurnDirectives } from '../agentControlGraph';
import { prepareAgentTurn } from '../agentTurnPreparation';
import type { PreparedAgentTurn } from '../agentTurnPreparation';
import type { PromptContextSupport } from '../prepareAgentControlGraphModelTurnTypes';
import type { ToolDefinition } from '../../../types/tool';
import type { Message } from '../../../types/message';
import { captureMemoryReadEpoch, isMemoryReadEpochCurrent } from '../../../services/memory/policy';
import {
  captureMemoryAuthoritySnapshot,
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../services/memory/memoryAuthority';
import { isMemoryValidityDeadlineCurrent } from '../../../services/memory/memoryValidityDeadline';
import { messageMatchesWorkflowTaskAnchor } from '../workflowTaskAnchor';
import { buildMemoryPolicyPromptSection } from '../../prompts/memoryPolicyPrompt';
import { renderPlanPromptSection } from '../../plan/agentPlan';
import {
  filterToolsForMemoryPolicy,
  isToolAllowedForMemoryPolicy,
} from '../../tools/memoryPolicyToolAuthority';

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
  const currentReadEpoch = captureMemoryReadEpoch();
  const livingMemoryAuthoritySnapshot = params.promptContextSupport.livingMemoryAuthoritySnapshot;
  const livingMemoryAuthorityCurrent =
    livingMemoryAuthoritySnapshot !== undefined &&
    isRestrictiveMemoryAuthoritySnapshotCurrent(livingMemoryAuthoritySnapshot) &&
    isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(livingMemoryAuthoritySnapshot);
  const currentMemoryAuthoritySnapshot =
    livingMemoryAuthorityCurrent && livingMemoryAuthoritySnapshot
      ? livingMemoryAuthoritySnapshot
      : currentReadEpoch !== null
        ? captureMemoryAuthoritySnapshot()
        : null;
  const longTermMemoryEnabled =
    currentReadEpoch !== null && currentMemoryAuthoritySnapshot !== null;
  const groundedRequestScopedTools = filterToolsForMemoryPolicy(
    params.groundedRequestScopedTools,
    longTermMemoryEnabled,
  );
  const groundedToolNames = new Set(groundedRequestScopedTools.map((tool) => tool.name));
  const policyAuthorizedPinnedToolNames = params.pinnedToolNames.filter((name) =>
    groundedToolNames.has(name),
  );
  const hasCallableMemoryCapability =
    params.actionablePromptTurn &&
    params.toolingEnabledForProvider &&
    !params.effectiveForceTextThisTurn &&
    groundedRequestScopedTools.some((tool) => !isToolAllowedForMemoryPolicy(tool, false));
  const livingMemoryReadEpoch = params.promptContextSupport.livingMemoryReadEpoch;
  const livingMemoryReadCurrent =
    livingMemoryReadEpoch !== undefined &&
    isMemoryReadEpochCurrent(livingMemoryReadEpoch) &&
    livingMemoryAuthorityCurrent &&
    isMemoryValidityDeadlineCurrent(params.promptContextSupport.livingMemoryValidUntil);
  const memoryReadEpoch = livingMemoryReadCurrent
    ? livingMemoryReadEpoch
    : hasCallableMemoryCapability && currentReadEpoch !== null
      ? currentReadEpoch
      : undefined;
  const memoryAuthoritySnapshot = livingMemoryReadCurrent
    ? livingMemoryAuthoritySnapshot
    : memoryReadEpoch !== undefined
      ? currentMemoryAuthoritySnapshot
      : undefined;
  const livingMemorySections = livingMemoryReadCurrent
    ? params.promptContextSupport.livingMemorySections
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
      family: params.family,
      groundedRequestScopedTools: options.groundedTools,
      pinnedToolNames: options.pinnedTools,
      promptBundleContext: {
        allTools: params.allTools,
        effectiveForceTextReasonThisTurn: params.effectiveForceTextReasonThisTurn,
        groundedRequestScopedTools: options.groundedTools,
        iteration: params.iteration,
        livingMemorySections: params.actionablePromptTurn ? options.sections : undefined,
        maxToolIterations: params.promptContextSupport.maxToolIterations,
        planPromptSection: params.actionablePromptTurn
          ? renderPlanPromptSection(params.promptContextSupport.graphPlan)
          : null,
        resolvedPrompt: params.promptContextSupport.resolvedPrompt,
        runtimeContext: params.promptContextSupport.runtimeContext,
        runtimePolicyPrompt: buildMemoryPolicyPromptSection(options.longTermMemoryEnabled),
        skillPrompts: params.promptContextSupport.skillPrompts,
        workflowRuntimePrompt: params.workflowRuntimePrompt,
        workflowTaskAnchor: transcriptCarriesSoleFirstTurnAnchor ? undefined : workflowTaskAnchor,
      },
      toolingEnabledForProvider: params.toolingEnabledForProvider,
    });
  const preparedTurn = prepare({
    groundedTools: groundedRequestScopedTools,
    longTermMemoryEnabled,
    pinnedTools: policyAuthorizedPinnedToolNames,
    sections: livingMemorySections,
  });
  if (memoryReadEpoch === undefined || !memoryAuthoritySnapshot) return preparedTurn;
  return {
    ...preparedTurn,
    memoryReadFence: {
      readEpoch: memoryReadEpoch,
      memoryAuthoritySnapshot,
      ...(livingMemoryReadCurrent &&
      params.promptContextSupport.livingMemoryValidUntil !== undefined
        ? { validUntil: params.promptContextSupport.livingMemoryValidUntil }
        : {}),
    },
  };
}
