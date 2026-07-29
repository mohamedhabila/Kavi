import type { AgentGoal } from '../../../types/agentRun';
import type { Message } from '../../../types/message';
import type { ToolDefinition } from '../../../types/tool';
import type { ConversationMode } from '../../../types/conversation';
import type { TrackedAsyncOperation } from '../../pendingAsyncOperations';
import { resolveGoalCapabilityToolNames } from '../../goals/toolSurface';
import { normalizeToolName } from '../../tools/toolNameNormalization';
import { resolveAgentExecutionTurnContract } from '../agentExecutionTurnContract';
import { getPendingTrackedAsyncOperationToolNames } from '../../pendingAsyncOperations';
import { extractDiscoveryActivatedToolNames } from '../discoveryToolActivation';
import { resolveDefaultGroundedRequestScopedTools } from '../turnToolSurface';
import { filterToolsForMemoryPolicy } from '../../tools/memoryPolicyToolAuthority';

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
  groundedRequestScopedTools: ToolDefinition[];
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
  const pinnedToolNames = Array.from(
    new Set(resolveGoalCapabilityToolNames(goals, currentPolicyAuthorizedTools)),
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
    groundedRequestScopedTools,
    pendingAsyncMonitorToolNames,
    pinnedToolNames,
    toolSurfacePinTelemetry: {
      sessionPinnedCount,
      turnPinnedCount,
    },
  };
}
