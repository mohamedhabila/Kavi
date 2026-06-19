import type { Message } from '../../types/message';
import { isAssistantFinalResponsePlaceholder } from '../../utils/assistantMessageMetadata';

export const AGENT_CONTROL_GRAPH_FINAL_REVIEW_RECOVERY_TITLE = 'Final delivery recovery queued';
export const AGENT_CONTROL_GRAPH_FINAL_REVIEW_RECOVERY_DETAIL =
  'Final review is deferred until the workflow has a visible final answer to evaluate.';

export type AgentControlGraphFinalReviewRecoveryReason =
  | 'missing_final_candidate'
  | 'non_plain_final_candidate'
  | 'empty_final_candidate'
  | 'placeholder_final_candidate';

export type AgentControlGraphFinalReviewGate =
  | { type: 'ready'; candidatePreview: string }
  | {
      type: 'recover';
      reason: AgentControlGraphFinalReviewRecoveryReason;
      checkpointTitle: typeof AGENT_CONTROL_GRAPH_FINAL_REVIEW_RECOVERY_TITLE;
      checkpointDetail: string;
      logLevel: 'info';
      systemPrompt: string;
      userPrompt: string;
    };

function buildFinalReviewRecoveryDetail(
  reason: AgentControlGraphFinalReviewRecoveryReason,
): string {
  switch (reason) {
    case 'missing_final_candidate':
      return AGENT_CONTROL_GRAPH_FINAL_REVIEW_RECOVERY_DETAIL;
    case 'non_plain_final_candidate':
      return 'Final review is deferred because the latest candidate is not a user-facing assistant answer.';
    case 'empty_final_candidate':
      return 'Final review is deferred because the latest final answer has no visible text.';
    case 'placeholder_final_candidate':
      return 'Final review is deferred because the latest final answer is only a placeholder.';
    default:
      return AGENT_CONTROL_GRAPH_FINAL_REVIEW_RECOVERY_DETAIL;
  }
}

export function buildAgentControlGraphFinalReviewRecoverySystemPrompt(): string {
  return [
    '[SYSTEM FINAL DELIVERY RECOVERY]',
    'final_review_ready: false',
    'required_output: visible_user_answer',
    'deliver_from: current_request_and_verified_evidence',
  ].join('\n');
}

export function buildAgentControlGraphFinalReviewRecoveryUserPrompt(): string {
  return 'Deliver the user-facing final answer now.';
}

function buildRecoverGate(
  reason: AgentControlGraphFinalReviewRecoveryReason,
): Extract<AgentControlGraphFinalReviewGate, { type: 'recover' }> {
  return {
    type: 'recover',
    reason,
    checkpointTitle: AGENT_CONTROL_GRAPH_FINAL_REVIEW_RECOVERY_TITLE,
    checkpointDetail: buildFinalReviewRecoveryDetail(reason),
    logLevel: 'info',
    systemPrompt: buildAgentControlGraphFinalReviewRecoverySystemPrompt(),
    userPrompt: buildAgentControlGraphFinalReviewRecoveryUserPrompt(),
  };
}

export function buildAgentControlGraphFinalReviewGate(params: {
  candidateMessage?: Pick<
    Message,
    'role' | 'content' | 'toolCalls' | 'assistantMetadata' | 'subAgentEvent'
  >;
}): AgentControlGraphFinalReviewGate {
  const candidate = params.candidateMessage;
  if (!candidate) {
    return buildRecoverGate('missing_final_candidate');
  }

  if (candidate.role !== 'assistant' || !!candidate.subAgentEvent) {
    return buildRecoverGate('non_plain_final_candidate');
  }

  const candidatePreview = candidate.content.trim();
  if (!candidatePreview) {
    return buildRecoverGate('empty_final_candidate');
  }

  if (isAssistantFinalResponsePlaceholder(candidate as Message)) {
    return buildRecoverGate('placeholder_final_candidate');
  }

  return {
    type: 'ready',
    candidatePreview,
  };
}
