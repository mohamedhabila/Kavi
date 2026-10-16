import type {
  AgentRunControlGraphStatus,
  AgentRunPhaseKey,
  AgentRunStatus,
  AgentRunTerminalReason,
} from '../../types/agentRun';
import type { AssistantCompletionStatus } from '../../types/message';
import type { E2ERubric } from './types';

function completeEnum<All extends string>() {
  return <const Values extends readonly All[]>(
    values: Values & (Exclude<All, Values[number]> extends never ? unknown : never),
  ): Values => values;
}

export const E2E_PUBLIC_ASSISTANT_STATUSES = completeEnum<AssistantCompletionStatus | 'missing'>()([
  'complete',
  'incomplete',
  'missing',
]);

export const E2E_PUBLIC_RUN_STATUSES = completeEnum<
  AgentRunStatus | 'missing' | 'not_applicable'
>()(['running', 'completed', 'failed', 'cancelled', 'missing', 'not_applicable']);

export const E2E_PUBLIC_GRAPH_STATUSES = completeEnum<AgentRunControlGraphStatus>()([
  'ready',
  'model_turn',
  'awaiting_tool_results',
  'recovering',
  'waiting_async',
  'awaiting_user',
  'awaiting_review',
  'blocked',
  'finalized',
  'yielded',
  'cancelled',
  'failed',
]);

export const E2E_PUBLIC_RUN_PHASES = completeEnum<AgentRunPhaseKey>()([
  'assess',
  'plan',
  'work',
  'review',
  'pilot',
  'deliver',
]);

export const E2E_PUBLIC_TERMINAL_REASONS = completeEnum<AgentRunTerminalReason>()([
  'loop_detected',
  'terminal_blocked',
  'tool_failure',
  'user_cancelled',
  'missing_required_side_effect',
  'terminal_review_unavailable',
  'route_blocked',
]);

/** Every rubric kind, so public reports keep each failed rubric's kind. */
export const E2E_PUBLIC_RUBRIC_KINDS = completeEnum<E2ERubric['kind']>()([
  'cache_eligible_read_rate',
  'cache_prefix_readiness',
  'cache_read_tokens',
  'completion_gate_hold',
  'file_hash',
  'graph_audit_observed',
  'graph_status',
  'graph_terminal_success',
  'memory_item',
  'memory_item_absent',
  'memory_turns_indexed',
  'min_user_turns',
  'native_fixture_contains',
  'native_fixture_state',
  'token_budget',
  'tool_call_budget',
  'turn_clarification',
  'turn_completion',
  'turn_final_response_token',
  'turn_grounded_amounts',
  'turn_lifecycle_boundary',
  'turn_memory_answer',
  'turn_memory_selection',
  'turn_native_invocation_count',
  'turn_tool_call_count',
  'worker_result_token',
  'workspace_file',
  'workspace_file_absent',
]);

export const E2E_PUBLIC_FINISH_REASONS = [
  'STOP',
  'STOP_SEQUENCE',
  'TOOL_CALL',
  'command_result',
  'end_turn',
  'fallback_missing_final_response',
  'max_iterations',
  'response_failed',
  'stop',
  'stop_sequence',
  'surfaced_worker_output_pending',
  'tool_call',
  'tool_calls',
  'tool_use',
  'yielded',
] as const;

export const E2E_PUBLIC_MAX_FINAL_ASSISTANT_TEXT_LENGTH = 1_000_000;
