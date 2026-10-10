import type { AgentControlGraphEvent, AgentControlTurnDirectives } from './agentControlGraph';

export type CompletionGateHoldReason =
  | 'async_waiting_finalization_hold'
  | 'tool_error_repair'
  | 'empty_response_retry'
  | 'empty_tool_call_retry'
  | 'incomplete_delivery_continuation'
  | 'incomplete_tool_continuation'
  | 'malformed_tool_call_retry'
  | 'unsettled_tool_results';

export type CompletionGateDecision =
  | { type: 'ready' }
  | {
      type: 'hold';
      reason: CompletionGateHoldReason;
      graphEvent: AgentControlGraphEvent;
      systemPrompts: string[];
      missingRequiredEvidenceLabels: string[];
      nextConsecutivePendingAsyncNoToolTurns?: number;
      turnDirectives?: Partial<AgentControlTurnDirectives>;
      assistantContent?: string;
    };
