import type { AgentRunControlGraphState } from '../../types/agentRun';

const E2E_GRAPH_EXECUTION_COMPLETE_STATUSES = new Set<AgentRunControlGraphState['status']>([
  'finalized',
  'awaiting_review',
]);

export function isE2EGraphExecutionComplete(
  status: AgentRunControlGraphState['status'] | null | undefined,
): boolean {
  return status !== null && status !== undefined && E2E_GRAPH_EXECUTION_COMPLETE_STATUSES.has(status);
}
