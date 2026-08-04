import type {
  AgentRunControlGraphStatus,
  AgentRunPhaseKey,
  AgentRunStatus,
  AgentRunTerminalReason,
} from '../../types/agentRun';
import type { ConversationMode } from '../../types/conversation';
import type { AssistantCompletionStatus } from '../../types/message';
import type { RequestUnderstandingRouting } from '../../types/requestUnderstanding';
import type { ForegroundScenarioRouteDirective } from './foregroundScenarioDriverTypes';

function completeEnum<All extends string>() {
  return <const Values extends readonly All[]>(
    values: Values & (Exclude<All, Values[number]> extends never ? unknown : never),
  ): Values => values;
}

export const E2E_PUBLIC_ROUTE_DIRECTIVES = completeEnum<ForegroundScenarioRouteDirective>()([
  'production_auto',
  'forced_chitchat',
  'forced_agentic',
]);

export const E2E_PUBLIC_CONVERSATION_MODES = completeEnum<ConversationMode>()([
  'agentic',
  'chitchat',
]);

export const E2E_PUBLIC_BUILT_IN_PERSONA_IDS = [
  'super-agent',
  'default',
  'coder',
  'researcher',
  'writer',
  'planner',
] as const;

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

export const E2E_PUBLIC_REQUEST_CONTINUATIONS = completeEnum<
  RequestUnderstandingRouting['continuation']
>()(['new', 'resume', 'resume_waiting_async', 'resume_waiting_user']);

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
  'goal_infeasible',
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
  'terminal_review_pending',
  'tool_call',
  'tool_calls',
  'tool_use',
  'yielded',
] as const;

export const E2E_PUBLIC_MAX_FINAL_ASSISTANT_TEXT_LENGTH = 1_000_000;
