import { useChatStore } from '../store/useChatStore';
import { isAgentRunAwaitingBackgroundWorkers } from '../services/agents/agentRunAsyncState';
import { AgentRun } from '../types/agentRun';
import { ConversationLogEntry } from '../types/conversation';

type ChatStore = ReturnType<typeof useChatStore.getState>;

export function completeTerminalBackgroundReviewRun(params: {
  appendConversationLog: (
    conversationId: string,
    entry: {
      title: string;
      detail?: string;
      level?: ConversationLogEntry['level'];
      kind?: ConversationLogEntry['kind'];
      timestamp?: number;
    },
  ) => void;
  completeAgentRun: ChatStore['completeAgentRun'];
  completion: {
    checkpointDetail?: string;
    checkpointTitle: string;
    latestSummary: string;
    logDetail?: string;
    logLevel: ConversationLogEntry['level'];
    logTitle: string;
    status: Exclude<AgentRun['status'], 'running'>;
  };
  conversationId: string;
  reviewTimestamp: number;
  runId: string;
  targetRun: AgentRun;
}): boolean {
  const latestRunState = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId)
    ?.agentRuns?.find((candidate) => candidate.id === params.runId);
  if (
    !latestRunState ||
    latestRunState.status !== 'running' ||
    !isAgentRunAwaitingBackgroundWorkers(latestRunState)
  ) {
    return false;
  }

  params.completeAgentRun(
    params.conversationId,
    {
      status: params.completion.status,
      latestSummary: params.completion.latestSummary,
      checkpointTitle: params.completion.checkpointTitle,
      checkpointDetail: params.completion.checkpointDetail,
      summary: {
        durationMs: Math.max(0, params.reviewTimestamp - params.targetRun.createdAt),
      },
      timestamp: params.reviewTimestamp,
    },
    params.runId,
  );
  params.appendConversationLog(params.conversationId, {
    kind: 'state',
    level: params.completion.logLevel,
    title: params.completion.logTitle,
    detail: params.completion.logDetail,
    timestamp: params.reviewTimestamp,
  });

  return true;
}
