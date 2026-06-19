import type { AgentGoal } from '../../types/agentRun';
import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { isSessionCoordinationToolName } from '../tools/sessionToolKinds';
import { resolveGoalBootstrapState } from '../goals/bootstrap';
import { resolveGoalCapabilityToolNames } from '../goals/toolSurface';

export interface AgentExecutionTurnContract {
  allowSessionCoordinationTools: boolean;
}

export function resolveAgentExecutionTurnContract(params: {
  goals: ReadonlyArray<AgentGoal>;
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description' | 'contract'>>;
  groundedToolNames: Iterable<string>;
}): AgentExecutionTurnContract {
  const bootstrap = resolveGoalBootstrapState(params.goals);
  const goalCapabilityToolNames = new Set(
    resolveGoalCapabilityToolNames(params.goals, params.tools),
  );
  const groundedNames = new Set(
    Array.from(params.groundedToolNames)
      .map((value) => normalizeToolName(value))
      .filter(Boolean),
  );

  const graphSelectedNames = bootstrap.shouldOfferGoalBootstrap
    ? groundedNames
    : new Set([...goalCapabilityToolNames].filter((name) => groundedNames.has(name)));

  const routeRequiresSessionCoordination = Array.from(graphSelectedNames).some(
    isSessionCoordinationToolName,
  );

  return {
    allowSessionCoordinationTools: routeRequiresSessionCoordination,
  };
}
