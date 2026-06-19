import { isAgentRunAwaitingBackgroundWorkers } from '../../services/agents/agentRunAsyncState';
import { summarizeBackgroundWorkerRunOutcome } from '../../services/agents/lifecycle/agentRunStateMachine';
import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { ReviewableWorkerSnapshots } from './terminalBackgroundReviewEligibility';

export type AgentControlGraphTerminalBackgroundReviewContext = {
  conversation: Conversation;
  targetRun: AgentRun;
  candidateSummary: string;
  candidateStatus: 'completed' | 'failed';
};

export function buildAgentControlGraphTerminalBackgroundReviewContext(params: {
  conversation: Conversation;
  runId: string;
  workers: ReviewableWorkerSnapshots;
}): AgentControlGraphTerminalBackgroundReviewContext | null {
  const targetRun = params.conversation.agentRuns?.find(
    (candidate) => candidate.id === params.runId,
  );
  if (
    !targetRun ||
    targetRun.status !== 'running' ||
    !isAgentRunAwaitingBackgroundWorkers(targetRun)
  ) {
    return null;
  }

  if (params.workers.liveSnapshots.some((snapshot) => snapshot.status === 'running')) {
    return null;
  }

  const effectiveWorkers = params.workers.hasOrphanedRunningSnapshots
    ? params.workers.mergedSnapshots.filter((snapshot) => snapshot.status !== 'running')
    : params.workers.mergedSnapshots;
  const candidateOutcome =
    params.workers.mergedSnapshots.length === 0
      ? {
          status: 'failed' as const,
          summary: 'Background worker state was lost before the run could be finalized.',
        }
      : params.workers.hasOrphanedRunningSnapshots
        ? {
            status: 'failed' as const,
            summary:
              'Background worker state became orphaned before completion could be confirmed.',
          }
        : summarizeBackgroundWorkerRunOutcome([...effectiveWorkers]);

  return {
    conversation: params.conversation,
    targetRun,
    candidateSummary: candidateOutcome.summary,
    candidateStatus: candidateOutcome.status === 'completed' ? 'completed' : 'failed',
  };
}
