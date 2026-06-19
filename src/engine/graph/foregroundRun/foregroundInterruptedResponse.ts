import {
  type AgentControlGraphInterruptedResponseOutcome,
  buildAgentControlGraphInterruptedGoalsCompleteOutcome,
  buildAgentControlGraphInterruptedGoalsResumeOutcome,
  buildAgentControlGraphInterruptedNoEvidenceOutcome,
  buildAgentControlGraphInterruptedTurnFailedOutcome,
  buildAgentControlGraphProviderRejectedInterruptedOutcome,
} from '../interruptedResponseRecovery';
import { getAgentRunPendingAsyncOperations } from '../../../services/agents/agentRunAsyncState';
import {
  collectAgentRunFinalizationEvidence,
  hasCompletedExecutionRecoveryEvidence,
} from '../../../services/agents/lifecycle/finalizePhase';
import { buildAgentRunMessageScope } from '../../../services/agents/lifecycle/agentRunStateMachine';
import { isNonRetryableProviderRequestError } from '../../../services/llm/support/requestErrors';
import { useChatStore } from '../../../store/useChatStore';
import { ResolvedFinalizationProviderContext } from './contracts';
import { getReviewableSubAgentsForRun } from '../../../services/agents/subAgentRunTracking';

function hasIncompleteGoals(goals: ReadonlyArray<{ status: string }>): boolean {
  return goals.some((goal) => goal.status === 'active' || goal.status === 'pending');
}

export async function resolveForegroundInterruptedResponseOutcome(params: {
  assertNotAborted: () => void;
  conversationId: string;
  error: Error;
  finalizationProviderContext: ResolvedFinalizationProviderContext;
  runId?: string;
  signal: AbortSignal;
}): Promise<AgentControlGraphInterruptedResponseOutcome> {
  if (isNonRetryableProviderRequestError(params.error)) {
    return buildAgentControlGraphProviderRejectedInterruptedOutcome(params.error.message);
  }

  if (!params.runId) {
    return buildAgentControlGraphInterruptedTurnFailedOutcome(params.error.message);
  }

  const latestConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  const targetRun = latestConversation?.agentRuns?.find(
    (candidate) => candidate.id === params.runId,
  );

  if (!latestConversation || !targetRun) {
    return buildAgentControlGraphInterruptedTurnFailedOutcome(params.error.message);
  }

  const {
    liveSnapshots: liveSubAgents,
    mergedSnapshots: reviewableSubAgents,
    hasOrphanedRunningSnapshots,
  } = getReviewableSubAgentsForRun(latestConversation, targetRun);
  const runningBackgroundWorkerCount = liveSubAgents.filter(
    (snapshot) => snapshot.status === 'running',
  ).length;
  const pendingAsyncOperations = getAgentRunPendingAsyncOperations(targetRun);
  const goals = targetRun.controlGraph?.goals ?? [];

  const evidence = collectAgentRunFinalizationEvidence(
    latestConversation.messages,
    buildAgentRunMessageScope(targetRun),
    targetRun.controlGraph?.iteration ?? 0,
    { liveSubAgentSnapshots: liveSubAgents },
  );

  if (
    !hasCompletedExecutionRecoveryEvidence({
      evidence,
      liveSubAgentSnapshots: liveSubAgents,
      pendingAsyncOperationCount: pendingAsyncOperations.length,
    })
  ) {
    return buildAgentControlGraphInterruptedNoEvidenceOutcome({
      errorMessage: params.error.message,
      runningBackgroundWorkerCount,
      pendingOperations: pendingAsyncOperations,
    });
  }

  params.assertNotAborted();

  if (hasIncompleteGoals(goals)) {
    const activeGoals = goals.filter((goal) => goal.status === 'active').map((goal) => goal.title);
    const pendingGoals = goals
      .filter((goal) => goal.status === 'pending')
      .map((goal) => goal.title);
    return buildAgentControlGraphInterruptedGoalsResumeOutcome({
      checkpointTitle: 'Goals still open',
      checkpointDetail: params.error.message,
      resumePrompt: [
        'Resume the run and continue executing open goals.',
        activeGoals.length > 0 ? `Active: ${activeGoals.join(', ')}` : undefined,
        pendingGoals.length > 0 ? `Pending: ${pendingGoals.join(', ')}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
      resumeUserPrompt: 'Continue from the interrupted supervisor turn.',
    });
  }

  if (
    hasOrphanedRunningSnapshots ||
    reviewableSubAgents.some((worker) => worker.status === 'running')
  ) {
    return buildAgentControlGraphInterruptedNoEvidenceOutcome({
      errorMessage: params.error.message,
      runningBackgroundWorkerCount,
      pendingOperations: pendingAsyncOperations,
    });
  }

  return buildAgentControlGraphInterruptedGoalsCompleteOutcome();
}
