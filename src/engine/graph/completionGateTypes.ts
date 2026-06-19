import type { AgentControlGraphEvent, AgentControlTurnDirectives } from './agentControlGraph';

export type CompletionGateHoldReason =
  | 'async_waiting_finalization_hold'
  | 'goals_incomplete'
  | 'goal_evidence_incomplete'
  | 'graph_state_reconciliation'
  | 'graph_mutation_error'
  | 'tool_error_repair'
  | 'workflow_continuation'
  | 'empty_tool_call_retry'
  | 'incomplete_delivery_continuation'
  | 'malformed_tool_call_retry'
  | 'no_tool_progress_retry'
  | 'unsettled_tool_results';

export type CompletionGateDecision =
  | { type: 'ready' }
  | {
      type: 'auto_complete_goals';
      reason: 'goal_evidence_satisfied' | 'delegation_evidence_satisfied';
      graphEvent: Extract<AgentControlGraphEvent, { type: 'GOALS_UPDATED' }>;
    }
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
