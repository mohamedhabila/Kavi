import type { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import type { ConversationLogEntry } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import { isDeliverableAssistantCompletionMetadata } from '../../../utils/assistantMessageMetadata';
import { classifyAgentControlGraphTerminalReason } from '../terminalOutcome';

type ReviewCandidateMessage = Pick<
  Message,
  'role' | 'content' | 'toolCalls' | 'assistantMetadata' | 'subAgentEvent'
>;

export type AgentControlGraphTerminalReviewCompletion = {
  status: 'failed' | 'cancelled';
  latestSummary: string;
  checkpointTitle: 'Run blocked' | 'Run failed' | 'Run cancelled';
  checkpointDetail: string;
  terminalReason: AgentRunTerminalReason;
  logLevel: Extract<ConversationLogEntry['level'], 'error' | 'warning'>;
  logTitle: 'Run blocked' | 'Run failed' | 'Run cancelled';
  logDetail: string;
};

export function buildAgentControlGraphTerminalReviewCompletion(
  controlGraph: AgentRun['controlGraph'],
  candidateMessage?: ReviewCandidateMessage,
): AgentControlGraphTerminalReviewCompletion | undefined {
  const reason =
    controlGraph?.terminalReason?.trim() ||
    controlGraph?.finalizationHoldReason?.trim() ||
    'blocked';
  const cancelledPreview =
    controlGraph?.status === 'cancelled' &&
    reason === 'user_approval_denied' &&
    candidateMessage?.role === 'assistant' &&
    !candidateMessage.subAgentEvent &&
    (candidateMessage.toolCalls?.length ?? 0) === 0 &&
    candidateMessage.assistantMetadata?.finishReason === 'user_approval_denied' &&
    isDeliverableAssistantCompletionMetadata(candidateMessage.assistantMetadata)
      ? candidateMessage.content.trim()
      : '';
  if (cancelledPreview) {
    return {
      status: 'cancelled',
      latestSummary: cancelledPreview,
      checkpointTitle: 'Run cancelled',
      checkpointDetail: cancelledPreview,
      terminalReason: 'user_cancelled',
      logLevel: 'warning',
      logTitle: 'Run cancelled',
      logDetail: cancelledPreview,
    };
  }

  if (
    !controlGraph ||
    !(
      controlGraph.status === 'blocked' ||
      controlGraph.status === 'failed' ||
      controlGraph.status === 'cancelled' ||
      (controlGraph.status === 'finalized' && controlGraph.terminalReason === 'max_iterations')
    )
  ) {
    return undefined;
  }

  const blocked =
    controlGraph.status === 'blocked' || controlGraph.terminalReason === 'max_iterations';
  const title = blocked ? 'Run blocked' : 'Run failed';
  const detail = `The control graph reached an unsuccessful ${controlGraph.status} state before review: ${reason}.`;

  return {
    status: 'failed',
    latestSummary: detail,
    checkpointTitle: title,
    checkpointDetail: detail,
    terminalReason: classifyAgentControlGraphTerminalReason(controlGraph),
    logLevel: 'error',
    logTitle: title,
    logDetail: detail,
  };
}

export function shouldMarkCandidatePendingReview(
  candidateMessage: ReviewCandidateMessage | undefined,
): boolean {
  return (
    candidateMessage?.role === 'assistant' &&
    !candidateMessage.subAgentEvent &&
    (candidateMessage.toolCalls?.length ?? 0) === 0 &&
    isDeliverableAssistantCompletionMetadata(candidateMessage.assistantMetadata)
  );
}
