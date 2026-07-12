import { readPendingGoalUserConstraintDelivery } from '../goals/userConstraintFinalDelivery';
import { hasIncompleteBlockingGoals } from '../goals/types';
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
  | { state: 'constraint_conflict' }
  | {
      state: 'settled';
      preview: string;
      acknowledgeUserConstraints: boolean;
    };

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
 * scope. A constraint mutation is itself a newer assistant projection, so it
 * supersedes any earlier final. Message timestamps are intentionally excluded:
 * foreground delivery updates a placeholder created before goal completion.
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

  const pendingDelivery = readPendingGoalUserConstraintDelivery(graph.goals);
  if (pendingDelivery.state === 'conflict') {
    return { state: 'constraint_conflict' };
  }

  return {
    state: 'settled',
    preview,
    acknowledgeUserConstraints: pendingDelivery.state === 'canonical',
  };
}

export function buildAgentControlGraphAfterPersistedFinalDelivery(params: {
  messages: Message[];
  run: Pick<AgentRun, 'controlGraph' | 'createdAt' | 'userMessageId'>;
  terminalReason?: string;
}): AgentRunControlGraphState | undefined {
  const graph = params.run.controlGraph;
  if (
    !graph ||
    !isAgentControlGraphAtPersistedFinalDeliveryBoundary(graph) ||
    hasIncompleteBlockingGoals(graph.goals ?? [])
  ) {
    return undefined;
  }

  const delivery = inspectPersistedAgentRunFinalDelivery(params);
  if (delivery.state !== 'settled') return undefined;

  if (graph.status === 'finalized' && !delivery.acknowledgeUserConstraints) {
    return graph;
  }
  const replayableGraph =
    graph.status === 'finalized' ? { ...graph, status: 'awaiting_review' as const } : graph;
  const finalizedGraph = reduceAgentControlGraph(replayableGraph, [
    ...(delivery.acknowledgeUserConstraints
      ? ([{ type: 'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED' }] as const)
      : []),
    { type: 'FINALIZED', reason: params.terminalReason ?? 'completed' },
  ]);
  if (
    finalizedGraph.status !== 'finalized' ||
    (delivery.acknowledgeUserConstraints &&
      readPendingGoalUserConstraintDelivery(finalizedGraph.goals).state !== 'absent')
  ) {
    return undefined;
  }
  return finalizedGraph;
}
