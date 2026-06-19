import { useChatStore } from '../store/useChatStore';
import { isAgentRunAwaitingBackgroundWorkers } from '../services/agents/agentRunAsyncState';
import { getLiveSubAgentsForRun } from '../services/agents/subAgentRunTracking';
import { QueueTerminalBackgroundReview } from './subAgentRunBridgeTypes';

export function queueTerminalReviewWhenWorkersSettled(params: {
  conversationId: string;
  runId?: string;
  timestamp: number;
  queueTerminalBackgroundReview: QueueTerminalBackgroundReview;
}): void {
  if (!params.runId) {
    return;
  }

  const latestConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  const targetRun = latestConversation?.agentRuns?.find((run) => run.id === params.runId);
  if (
    !latestConversation ||
    !targetRun ||
    targetRun.status !== 'running' ||
    !isAgentRunAwaitingBackgroundWorkers(targetRun)
  ) {
    return;
  }

  const liveSubAgents = getLiveSubAgentsForRun(latestConversation, params.runId);
  if (liveSubAgents.some((snapshot) => snapshot.status === 'running')) {
    return;
  }

  void params.queueTerminalBackgroundReview({
    conversationId: params.conversationId,
    runId: params.runId,
    timestamp: params.timestamp,
  });
}
