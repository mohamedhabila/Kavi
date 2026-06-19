import type { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import type { ConversationLogEntry } from '../../../types/conversation';
import type { Message } from '../../../types/message';

type ReviewCandidateMessage = Pick<
  Message,
  'role' | 'content' | 'toolCalls' | 'assistantMetadata' | 'subAgentEvent'
>;

export type AgentControlGraphTerminalReviewCompletion = {
  status: 'failed';
  latestSummary: string;
  checkpointTitle: 'Run blocked';
  checkpointDetail: string;
  terminalReason: Extract<AgentRunTerminalReason, 'missing_required_side_effect'>;
  logLevel: Extract<ConversationLogEntry['level'], 'error'>;
  logTitle: 'Run blocked';
  logDetail: string;
};

export function buildAgentControlGraphTerminalReviewCompletion(
  controlGraph: AgentRun['controlGraph'],
): AgentControlGraphTerminalReviewCompletion | undefined {
  if (controlGraph?.status !== 'blocked') {
    return undefined;
  }

  const reason =
    controlGraph.terminalReason?.trim() || controlGraph.finalizationHoldReason?.trim() || 'blocked';
  const detail = `The control graph reached a blocked terminal state before review: ${reason}.`;

  return {
    status: 'failed',
    latestSummary: detail,
    checkpointTitle: 'Run blocked',
    checkpointDetail: detail,
    terminalReason: 'missing_required_side_effect',
    logLevel: 'error',
    logTitle: 'Run blocked',
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
    candidateMessage.assistantMetadata?.kind === 'final' &&
    candidateMessage.assistantMetadata.completionStatus === 'complete'
  );
}
