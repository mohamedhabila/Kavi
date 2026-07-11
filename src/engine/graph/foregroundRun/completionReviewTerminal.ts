import type { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import type { ConversationLogEntry } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import { classifyAgentControlGraphTerminalReason } from '../terminalOutcome';

type ReviewCandidateMessage = Pick<
  Message,
  'role' | 'content' | 'toolCalls' | 'assistantMetadata' | 'subAgentEvent'
>;

export type AgentControlGraphTerminalReviewCompletion = {
  status: 'failed';
  latestSummary: string;
  checkpointTitle: 'Run blocked' | 'Run failed';
  checkpointDetail: string;
  terminalReason: AgentRunTerminalReason;
  logLevel: Extract<ConversationLogEntry['level'], 'error'>;
  logTitle: 'Run blocked' | 'Run failed';
  logDetail: string;
};

export function buildAgentControlGraphTerminalReviewCompletion(
  controlGraph: AgentRun['controlGraph'],
): AgentControlGraphTerminalReviewCompletion | undefined {
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

  const reason =
    controlGraph.terminalReason?.trim() || controlGraph.finalizationHoldReason?.trim() || 'blocked';
  const blocked = controlGraph.status === 'blocked' || controlGraph.terminalReason === 'max_iterations';
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
    candidateMessage.assistantMetadata?.kind === 'final' &&
    candidateMessage.assistantMetadata.completionStatus === 'complete'
  );
}
