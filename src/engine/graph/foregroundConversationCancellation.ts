import {
  cancelAgentRunOperations,
  clearAgentRunCancellation,
  isAbortErrorLike,
} from '../../services/agents/agentRunCancellation';
import {
  cancelRunningSubAgentsForRun,
  getLiveSubAgentsForRun,
  getRunningConversationRunsForCancellation,
  getRunningLiveSubAgentsForRun,
} from '../../services/agents/subAgentRunTracking';
import type { AgentRun } from '../../types/agentRun';
import type { Conversation, ConversationLogEntry } from '../../types/conversation';
import {
  applyConversationRunCompletionEffect,
  type ConversationRunCompletionActions,
} from './applyRunCompletionEffect';
import {
  buildForegroundRunSupersededEffect,
  buildForegroundRunUserStopCompletionEffect,
  buildForegroundRunUserStopLogEntry,
} from './foregroundRunTerminalEffects';

type AppendConversationLogEntry = Pick<ConversationLogEntry, 'detail' | 'kind' | 'level' | 'title'>;

type EnsureAgentRunFinalResponse = (params: {
  conversationId: string;
  runId: string;
  status: Exclude<AgentRun['status'], 'running'>;
  timestamp?: number;
}) => Promise<string | undefined>;

type ForegroundConversationCancellationActions = ConversationRunCompletionActions & {
  appendConversationLog: (conversationId: string, entry: AppendConversationLogEntry) => void;
  clearForegroundRequestForConversation?: (conversationId: string) => boolean;
  clearPendingRunState: (runId: string) => void;
  ensureAgentRunFinalResponse?: EnsureAgentRunFinalResponse;
  getLatestConversation: (conversationId: string) => Conversation | undefined;
};

const USER_STOP_REASON = 'Cancelled because the supervising turn was stopped by the user.';

export function selectForegroundSupersededRun(params: {
  conversation?: Conversation;
  reuseAgentRunId?: string;
}): {
  existingRun?: AgentRun;
  supersededRun?: AgentRun;
  supersededRunningWorkerCount: number;
} {
  const existingRun = params.reuseAgentRunId
    ? params.conversation?.agentRuns?.find(
        (candidate) => candidate.id === params.reuseAgentRunId && candidate.status === 'running',
      )
    : undefined;
  const supersededRun = !existingRun
    ? params.conversation?.agentRuns?.find(
        (candidate) =>
          candidate.id === params.conversation?.activeAgentRunId && candidate.status === 'running',
      )
    : undefined;
  const supersededRunningWorkerCount =
    supersededRun && params.conversation
      ? getLiveSubAgentsForRun(params.conversation, supersededRun.id).filter(
          (agent) => agent.status === 'running',
        ).length
      : 0;

  return {
    existingRun,
    supersededRun,
    supersededRunningWorkerCount,
  };
}

export function rewindForegroundConversationRun(params: {
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => boolean;
  clearPendingRunState: (runId: string) => void;
  conversation?: Conversation;
  conversationId: string;
  reason: string;
}): void {
  params.abortForegroundRequestForConversation(params.conversationId, params.reason);

  const activeRunId = params.conversation?.activeAgentRunId;
  if (!params.conversation || !activeRunId) {
    return;
  }

  cancelAgentRunOperations(params.conversationId, activeRunId, params.reason);
  cancelRunningSubAgentsForRun(params.conversation, activeRunId, params.reason);
  params.clearPendingRunState(activeRunId);
}

export function supersedeForegroundConversationRun(params: {
  actions: ForegroundConversationCancellationActions;
  conversation: Conversation;
  conversationId: string;
  runId: string;
  runningWorkerCount: number;
}): void {
  const supersedeEffect = buildForegroundRunSupersededEffect(params.runningWorkerCount);

  cancelAgentRunOperations(params.conversationId, params.runId, supersedeEffect.operationReason);
  params.actions.clearPendingRunState(params.runId);
  applyConversationRunCompletionEffect({
    actions: params.actions,
    conversationId: params.conversationId,
    effect: supersedeEffect.completion,
    getLatestConversation: () => params.actions.getLatestConversation(params.conversationId),
    runId: params.runId,
  });
  cancelRunningSubAgentsForRun(params.conversation, params.runId, supersedeEffect.workerReason);
  params.actions.appendConversationLog(params.conversationId, supersedeEffect.logEntry);
}

export function stopForegroundConversationRuns(params: {
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => boolean;
  actions: ForegroundConversationCancellationActions;
  conversation?: Conversation;
  conversationId: string;
}): void {
  const runsToCancel = params.conversation
    ? getRunningConversationRunsForCancellation(params.conversation)
    : [];
  const cancelledWorkerCount = runsToCancel.reduce((count, run) => {
    const runWorkers = params.conversation
      ? getRunningLiveSubAgentsForRun(params.conversation, run.id)
      : [];
    const cancellationEffect = buildForegroundRunUserStopCompletionEffect(runWorkers.length);

    cancelAgentRunOperations(params.conversationId, run.id, cancellationEffect.operationReason);
    params.actions.clearPendingRunState(run.id);
    applyConversationRunCompletionEffect({
      actions: params.actions,
      conversationId: params.conversationId,
      effect: cancellationEffect,
      getLatestConversation: () => params.actions.getLatestConversation(params.conversationId),
      runId: run.id,
    });
    clearAgentRunCancellation(params.conversationId, run.id);
    void params.actions
      .ensureAgentRunFinalResponse?.({
        conversationId: params.conversationId,
        runId: run.id,
        status: 'cancelled',
        timestamp: Date.now(),
      })
      .catch((error: unknown) => {
        if (isAbortErrorLike(error)) {
          return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        params.actions.appendConversationLog(params.conversationId, {
          kind: 'error',
          level: 'error',
          title: 'Cancellation report failed',
          detail,
        });
      });

    if (params.conversation) {
      cancelRunningSubAgentsForRun(params.conversation, run.id, cancellationEffect.workerReason);
    }

    return count + runWorkers.length;
  }, 0);

  params.actions.appendConversationLog(
    params.conversationId,
    buildForegroundRunUserStopLogEntry({
      cancelledRunCount: runsToCancel.length,
      cancelledWorkerCount,
    }),
  );

  params.abortForegroundRequestForConversation(params.conversationId, USER_STOP_REASON);
  params.actions.clearForegroundRequestForConversation?.(params.conversationId);
}
