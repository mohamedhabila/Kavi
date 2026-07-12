import { prepareAgentRunControlGraphForResume } from '../../../services/agents/agentControlGraphState';
import type { AgentRunControlGraphState } from '../../../types/agentRun';
import { reduceAgentControlGraph } from '../agentControlGraph';

export const MAX_AGENT_RUN_AUTOMATIC_RECOVERY_ATTEMPTS = 1;

export type AgentRunAutomaticRecoveryBudgetResult =
  | { type: 'consumed'; controlGraph: AgentRunControlGraphState }
  | { type: 'exhausted' }
  | { type: 'unavailable' };

export function consumeAgentRunAutomaticRecoveryAttempt(params: {
  controlGraph: AgentRunControlGraphState | undefined;
  reason: string;
  timestamp?: number;
}): AgentRunAutomaticRecoveryBudgetResult {
  const graph = params.controlGraph;
  if (!graph) return { type: 'unavailable' };

  const currentAttemptCount = graph.turnDirectives.automaticRecoveryAttemptCount ?? 0;
  if (currentAttemptCount >= MAX_AGENT_RUN_AUTOMATIC_RECOVERY_ATTEMPTS) {
    return { type: 'exhausted' };
  }

  const timestamp = params.timestamp ?? Date.now();
  const resumableGraph = prepareAgentRunControlGraphForResume(graph, {
    reason: params.reason,
    updatedAt: timestamp,
  });
  if (!resumableGraph || resumableGraph.status !== 'ready') {
    return { type: 'unavailable' };
  }

  const controlGraph = reduceAgentControlGraph(resumableGraph, [
    {
      type: 'TURN_DIRECTIVES_RECORDED',
      directives: { automaticRecoveryAttemptCount: currentAttemptCount + 1 },
      reason: params.reason,
      timestamp,
    },
  ]);
  return controlGraph.turnDirectives.automaticRecoveryAttemptCount === currentAttemptCount + 1
    ? { type: 'consumed', controlGraph }
    : { type: 'unavailable' };
}
