import type { AgentRunStatus, AgentRunTerminalReason } from '../../types/agentRun';
import type { AgentControlGraphEvent } from './agentControlGraph';

type TerminalGraphEvent = Extract<
  AgentControlGraphEvent,
  { type: 'BLOCKED' } | { type: 'FINALIZED' } | { type: 'CANCELLED' } | { type: 'FAILED' }
>;

const BLOCKED_TERMINAL_REASONS: ReadonlySet<AgentRunTerminalReason> = new Set([
  'terminal_review_unavailable',
  'loop_detected',
  'missing_required_side_effect',
  'terminal_blocked',
  'route_blocked',
]);

export function buildAgentControlGraphTerminalEventForCompletion(params: {
  status: Exclude<AgentRunStatus, 'running'>;
  terminalReason?: AgentRunTerminalReason;
}): TerminalGraphEvent {
  if (params.status === 'cancelled') {
    return { type: 'CANCELLED', reason: params.terminalReason ?? 'cancelled' };
  }

  if (params.status === 'completed') {
    return { type: 'FINALIZED', reason: params.terminalReason ?? 'completed' };
  }

  if (params.terminalReason && BLOCKED_TERMINAL_REASONS.has(params.terminalReason)) {
    return { type: 'BLOCKED', reason: params.terminalReason };
  }

  return { type: 'FAILED', reason: params.terminalReason ?? 'failed' };
}
