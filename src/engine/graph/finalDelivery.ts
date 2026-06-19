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

export type AgentControlGraphFinalDeliveryResolution =
  | {
      type: 'use_recovered_preview';
      latestSummary: string;
    }
  | {
      type: 'insert_missing_final_response_fallback';
      completionStatus: 'complete';
      finishReason: 'fallback_missing_final_response';
    }
  | {
      type: 'use_checkpoint_summary';
      latestSummary: string;
    };

export function buildAgentControlGraphFinalDeliveryResolution(params: {
  status: Exclude<AgentRunStatus, 'running'>;
  finalPreview?: string;
  latestSummary?: string;
  checkpointDetail: string;
}): AgentControlGraphFinalDeliveryResolution {
  if (params.finalPreview) {
    return {
      type: 'use_recovered_preview',
      latestSummary: params.finalPreview,
    };
  }

  if (params.status === 'completed') {
    return {
      type: 'insert_missing_final_response_fallback',
      completionStatus: 'complete',
      finishReason: 'fallback_missing_final_response',
    };
  }

  return {
    type: 'use_checkpoint_summary',
    latestSummary: params.latestSummary || params.checkpointDetail,
  };
}
