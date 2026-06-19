import type { AgentGoal } from '../../../types/agentRun';
import type { Message } from '../../../types/message';
import type { ToolDefinition } from '../../../types/tool';
import type { TrackedAsyncOperation } from '../../pendingAsyncOperations';
import { resolveGoalCapabilityToolNames } from '../../goals/toolSurface';
import { normalizeToolName } from '../../tools/toolNameNormalization';
import { resolveAgentExecutionTurnContract } from '../agentExecutionTurnContract';
import { getPendingTrackedAsyncOperationToolNames } from '../../pendingAsyncOperations';
import { extractDiscoveryActivatedToolNames } from '../discoveryToolActivation';
import { resolveDefaultGroundedRequestScopedTools } from '../turnToolSurface';

export async function resolveModelTurnGroundedToolSurface(params: {
  allTools: ReadonlyArray<ToolDefinition>;
  completedWorkflowToolNames: ReadonlySet<string>;
  goals?: ReadonlyArray<AgentGoal>;
  useExplicitFilteredToolSurface?: boolean;
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

  const groundedRequestScopedTools = await resolveDefaultGroundedRequestScopedTools({
    allTools: params.allTools,
    observedToolNames: params.completedWorkflowToolNames,
    goals,
    pendingAsyncMonitorToolNames,
    workingMessages: params.workingMessages,
    useExplicitFilteredToolSurface: params.useExplicitFilteredToolSurface,
    sessionActivatedToolNames: params.sessionActivatedToolNames,
  });
  const groundedToolNames = new Set(
    groundedRequestScopedTools.map((tool) => normalizeToolName(tool.name)).filter(Boolean),
  );
  const pinnedToolNames = Array.from(
    new Set(resolveGoalCapabilityToolNames(goals, params.allTools)),
  ).filter((name) => groundedToolNames.has(name));
  const turnContract = resolveAgentExecutionTurnContract({
    goals,
    tools: params.allTools,
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
