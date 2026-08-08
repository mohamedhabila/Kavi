import type { AgentGoal } from '../../../types/agentRun';
import type { Message } from '../../../types/message';
import type { ToolDefinition } from '../../../types/tool';
import type { ConversationMode } from '../../../types/conversation';
import type { TrackedAsyncOperation } from '../../pendingAsyncOperations';
import {
  resolveAuthorizedToolNames,
  resolveGoalCapabilityToolNames,
} from '../../goals/toolSurface';
import { normalizeToolName } from '../../tools/toolNameNormalization';
import { resolveAgentExecutionTurnContract } from '../agentExecutionTurnContract';
import { getPendingTrackedAsyncOperationToolNames } from '../../pendingAsyncOperations';
import { extractDiscoveryActivatedToolNames } from '../discoveryToolActivation';
import { resolveDefaultGroundedRequestScopedTools } from '../turnToolSurface';
import { filterToolsForMemoryPolicy } from '../../tools/memoryPolicyToolAuthority';
import {
  detectChitchatModeEscalation,
  type ConversationModeEscalation,
} from '../conversation/modeEscalation';

export async function resolveModelTurnGroundedToolSurface(params: {
  allTools: ReadonlyArray<ToolDefinition>;
  conversationMode: ConversationMode;
  completedWorkflowToolNames: ReadonlySet<string>;
  goals?: ReadonlyArray<AgentGoal>;
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
  trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  sessionActivatedToolNames?: ReadonlyArray<string>;
  workingMessages: ReadonlyArray<Message>;
}): Promise<{
  allowSessionCoordinationTools: boolean;
  /** Set when a chitchat turn reached for a capability only an agentic run may use. */
  modeEscalation: ConversationModeEscalation;
  groundedRequestScopedTools: ToolDefinition[];
  /**
   * What the run may execute, as opposed to what this turn advertises. Execution consults
   * this; `groundedRequestScopedTools` only shapes what the model is shown.
   */
  authorizedToolNames: ReadonlySet<string>;
  pendingAsyncMonitorToolNames: ReadonlySet<string>;
  pinnedToolNames: string[];
  toolSurfacePinTelemetry: {
    sessionPinnedCount: number;
    turnPinnedCount: number;
  };
}> {
  const policyAuthorizedTools = filterToolsForMemoryPolicy(params.allTools);
  const pendingAsyncMonitorToolNames = new Set(
    getPendingTrackedAsyncOperationToolNames(params.trackedAsyncOperations),
  );
  const goals = params.goals ?? [];
  const messagesSinceLatestUserMessage = (() => {
    for (let index = params.workingMessages.length - 1; index >= 0; index -= 1) {
      if (params.workingMessages[index]?.role === 'user') {
        return params.workingMessages.slice(index + 1);
      }
    }
    return params.workingMessages;
  })();
  const turnActivatedCatalogToolNames = extractDiscoveryActivatedToolNames(
    messagesSinceLatestUserMessage,
  );
  const sessionActivatedToolNames = new Set(
    (params.sessionActivatedToolNames ?? [])
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );
  const explicitToolSurfaceToolNames = params.explicitToolSurfaceToolNames ?? [];

  const resolvedGroundedRequestScopedTools = await resolveDefaultGroundedRequestScopedTools({
    allTools: policyAuthorizedTools,
    conversationMode: params.conversationMode,
    observedToolNames: params.completedWorkflowToolNames,
    goals,
    pendingAsyncMonitorToolNames,
    workingMessages: params.workingMessages,
    explicitToolSurfaceToolNames,
    sessionActivatedToolNames: params.sessionActivatedToolNames,
  });
  // Tool selection may suspend while policy changes. Re-authorize the complete
  // result after the async boundary so stale memory capabilities never reach
  // prompt construction, pinning, or provider dispatch.
  const currentPolicyAuthorizedTools = filterToolsForMemoryPolicy(params.allTools);
  const groundedRequestScopedTools = filterToolsForMemoryPolicy(resolvedGroundedRequestScopedTools);
  const groundedToolNames = new Set(
    groundedRequestScopedTools.map((tool) => normalizeToolName(tool.name)).filter(Boolean),
  );
  // A tool this run has already invoked is the strongest relevance signal available:
  // the model chose it, it ran, and the run's state now depends on what it returned.
  // Evicting it under budget pressure does not save a round-trip, it spends one — the
  // next call is rejected as "not allowed in this context" and the model has to
  // re-discover the tool before it can continue. Traced live: `clipboard` and
  // `clipboard_read` each succeeded, were evicted, then failed on identical arguments
  // four more times until a `tool_catalog` call put them back on the surface. The set
  // is bounded twice over — by what the run actually invoked, and by the grounded
  // surface filter below — so this cannot grow without limit on a long run.
  const invokedToolNames = Array.from(params.completedWorkflowToolNames)
    .map((toolName) => normalizeToolName(toolName))
    .filter(Boolean);
  const pinnedToolNames = Array.from(
    new Set([
      ...resolveGoalCapabilityToolNames(goals, currentPolicyAuthorizedTools),
      ...invokedToolNames,
    ]),
  ).filter((name) => groundedToolNames.has(name));
  const turnContract = resolveAgentExecutionTurnContract({
    groundedToolNames: groundedRequestScopedTools.map((tool) => tool.name),
  });

  const sessionPinnedCount = groundedRequestScopedTools.filter((tool) =>
    sessionActivatedToolNames.has(normalizeToolName(tool.name)),
  ).length;
  const turnPinnedCount = groundedRequestScopedTools.filter((tool) =>
    turnActivatedCatalogToolNames.has(normalizeToolName(tool.name)),
  ).length;

  return {
    allowSessionCoordinationTools: turnContract.allowSessionCoordinationTools,
    modeEscalation: detectChitchatModeEscalation({
      conversationMode: params.conversationMode,
      allTools: policyAuthorizedTools,
      activatedCatalogToolNames: new Set([
        ...turnActivatedCatalogToolNames,
        ...sessionActivatedToolNames,
      ]),
    }),
    groundedRequestScopedTools,
    authorizedToolNames: resolveAuthorizedToolNames({
      allTools: currentPolicyAuthorizedTools,
      conversationMode: params.conversationMode,
      activatedCatalogToolNames: new Set([
        ...turnActivatedCatalogToolNames,
        ...sessionActivatedToolNames,
      ]),
      explicitToolSurfaceToolNames,
    }),
    pendingAsyncMonitorToolNames,
    pinnedToolNames,
    toolSurfacePinTelemetry: {
      sessionPinnedCount,
      turnPinnedCount,
    },
  };
}
