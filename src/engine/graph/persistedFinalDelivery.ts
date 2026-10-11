import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponsePreview,
} from '../../services/agents/lifecycle/agentRunStateMachine';
import type { AgentRun, AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import { reduceAgentControlGraph } from './agentControlGraph';

export type PersistedAgentRunFinalDelivery =
  | { state: 'missing' }
  | { state: 'unsafe_boundary' }
  | { state: 'settled'; preview: string };

/**
 * A persisted assistant message may settle a run only after the control graph
 * reached its explicit review boundary and all execution work is quiescent.
 * This prevents an older final message from terminalizing a newer model, tool,
 * recovery, or asynchronous-work boundary after restart.
 */
export function isAgentControlGraphAtPersistedFinalDeliveryBoundary(
  graph: AgentRunControlGraphState,
): boolean {
  if (graph.status !== 'awaiting_review' && graph.status !== 'finalized') {
    return false;
  }

  return (
    graph.expectedToolCalls.length === 0 &&
    graph.observedToolResults.length === 0 &&
    graph.pendingAsyncCount === 0 &&
    graph.asyncWork.awaitingBackgroundWorkers === false &&
    graph.asyncWork.pendingOperations.length === 0 &&
    !graph.finalizationHoldReason
  );
}

/**
 * Proves delivery from the latest plain assistant projection in the exact run
 * scope. Message timestamps are intentionally excluded: foreground delivery
 * updates a placeholder created before the run finished.
 */
export function inspectPersistedAgentRunFinalDelivery(params: {
  messages: Message[];
  run: Pick<AgentRun, 'controlGraph' | 'createdAt' | 'userMessageId'>;
}): PersistedAgentRunFinalDelivery {
  const preview = getLatestAssistantProjectionFinalResponsePreview(
    params.messages,
    buildAgentRunMessageScope(params.run),
  );
  if (!preview) return { state: 'missing' };

  const graph = params.run.controlGraph;
  if (!graph || !isAgentControlGraphAtPersistedFinalDeliveryBoundary(graph)) {
    return { state: 'unsafe_boundary' };
  }

  return { state: 'settled', preview };
}

export function buildAgentControlGraphAfterPersistedFinalDelivery(params: {
  messages: Message[];
  run: Pick<AgentRun, 'controlGraph' | 'createdAt' | 'userMessageId'>;
  terminalReason?: string;
}): AgentRunControlGraphState | undefined {
  const graph = params.run.controlGraph;
  if (!graph || !isAgentControlGraphAtPersistedFinalDeliveryBoundary(graph)) {
    return undefined;
  }

  const delivery = inspectPersistedAgentRunFinalDelivery(params);
  if (delivery.state !== 'settled') return undefined;

  if (graph.status === 'finalized') {
    return graph;
  }
  const finalizedGraph = reduceAgentControlGraph(graph, [
    { type: 'FINALIZED', reason: params.terminalReason ?? 'completed' },
  ]);
  return finalizedGraph.status === 'finalized' ? finalizedGraph : undefined;
}
