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
  const memory = params.promptContextSupport.memory;
  const memoryRead = memory?.status === 'read' ? memory : undefined;
  const memoryReadAuthorityCurrent =
    memoryRead !== undefined &&
    isRestrictiveMemoryAuthoritySnapshotCurrent(memoryRead.authoritySnapshot) &&
    isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(memoryRead.authoritySnapshot);
  const currentMemoryAuthoritySnapshot =
    memoryReadAuthorityCurrent && memoryRead
      ? memoryRead.authoritySnapshot
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
  const memoryReadCurrent =
    memoryRead !== undefined &&
    isMemoryReadEpochCurrent(memoryRead.policyEpoch) &&
    memoryReadAuthorityCurrent;
  const memoryReadEpoch = memoryReadCurrent
    ? memoryRead.policyEpoch
    : hasCallableMemoryCapability && currentReadEpoch !== null
      ? currentReadEpoch
      : undefined;
  const memoryAuthoritySnapshot = memoryReadCurrent
    ? memoryRead.authoritySnapshot
    : memoryReadEpoch !== undefined
      ? currentMemoryAuthoritySnapshot
      : undefined;
  const memorySection = memoryReadCurrent ? memoryRead.section?.text : undefined;
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
        workflowTaskAnchor: transcriptCarriesSoleFirstTurnAnchor ? undefined : workflowTaskAnchor,
      },
      toolingEnabledForProvider: params.toolingEnabledForProvider,
    });
  const preparedTurn = prepare({
    groundedTools: groundedRequestScopedTools,
    longTermMemoryEnabled,
    pinnedTools: policyAuthorizedPinnedToolNames,
    memorySection,
  });
  if (memoryReadEpoch === undefined || !memoryAuthoritySnapshot) return preparedTurn;
  return {
    ...preparedTurn,
    memoryReadFence: {
      readEpoch: memoryReadEpoch,
      memoryAuthoritySnapshot,
    },
  };
}
