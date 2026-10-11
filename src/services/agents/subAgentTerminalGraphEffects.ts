import type {
  AgentRun,
  AgentRunAsyncOperation,
  AgentRunControlGraphState,
} from '../../types/agentRun';
import type { SubAgentLifecycleEvent, SubAgentSnapshot } from '../../types/subAgent';
import { reduceAgentControlGraph } from '../../engine/graph/agentControlGraph';
import type { AgentControlGraphEvent } from '../../engine/graph/agentControlGraphTypes';

function removeTerminalSessionOperations(
  operations: ReadonlyArray<AgentRunAsyncOperation> | undefined,
  sessionId: string,
): AgentRunAsyncOperation[] {
  return (operations ?? []).filter((operation) => operation.resourceId !== sessionId);
}

/**
 * A worker that reached a terminal state no longer holds its parent run waiting: its
 * pending async operation leaves the run's graph. The worker's result reaches the parent
 * as the tool result that observed it.
 */
export function buildSubAgentTerminalControlGraphEvents(params: {
  run: Pick<AgentRun, 'controlGraph'>;
  agent: SubAgentSnapshot;
  event: SubAgentLifecycleEvent;
  timestamp?: number;
}): AgentControlGraphEvent[] {
  if (params.event === 'started') {
    return [];
  }

  const pendingOperations = removeTerminalSessionOperations(
    params.run.controlGraph?.asyncWork?.pendingOperations,
    params.agent.sessionId,
  );
  return [
    {
      type: 'ASYNC_WAITING',
      pendingAsyncCount: pendingOperations.length,
      pendingOperations,
      timestamp: params.timestamp ?? Date.now(),
    },
  ];
}

export function applySubAgentTerminalControlGraphEffects(params: {
  run: Pick<AgentRun, 'controlGraph'>;
  agent: SubAgentSnapshot;
  event: SubAgentLifecycleEvent;
  timestamp?: number;
}): AgentRunControlGraphState | undefined {
  const events = buildSubAgentTerminalControlGraphEvents(params);
  if (events.length === 0 || !params.run.controlGraph) {
    return params.run.controlGraph;
  }

  return reduceAgentControlGraph(params.run.controlGraph, events);
}
