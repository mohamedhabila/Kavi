import type { AgentRunStatus, AgentRunTerminalReason } from '../../types/agentRun';

export const AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE = 'Final response delivered';
export const AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_TITLE =
  'Final response synthesis started';
export const AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL =
  'Synthesizing final response from verified results.';

export function getAgentControlGraphFinalReportTitle(
  status: Exclude<AgentRunStatus, 'running'>,
  terminalReason?: AgentRunTerminalReason,
): string {
  if (status === 'completed') {
    return AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE;
  }
  if (status === 'cancelled') {
    return 'Cancellation report delivered';
  }
  if (
    terminalReason === 'terminal_blocked' ||
    terminalReason === 'terminal_review_unavailable' ||
    terminalReason === 'missing_required_side_effect' ||
    terminalReason === 'route_blocked'
  ) {
    return 'Blocker report delivered';
  }
  return 'Failure report delivered';
}
