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
import { resolveConversationWorkspaceTarget } from '../../services/conversationWorkspace/ownership';
import {
  cancelOwnedExternalRecoveries,
  type CancelOwnedExternalRecoveriesResult,
} from '../../services/executionJournal/foregroundExternalRecoveryCancellation';
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
  memoryConversationId?: string;
  timestamp?: number;
}) => Promise<string | undefined>;

type ForegroundConversationCancellationActions = ConversationRunCompletionActions & {
  appendConversationLog: (conversationId: string, entry: AppendConversationLogEntry) => void;
  clearForegroundRequestForConversation?: (conversationId: string) => boolean;
  clearPendingRunState: (conversationId: string, runId: string) => void;
  ensureAgentRunFinalResponse?: EnsureAgentRunFinalResponse;
  getLatestConversation: (conversationId: string) => Conversation | undefined;
};

const USER_STOP_REASON = 'Cancelled because the supervising turn was stopped by the user.';

function durableCancellationAttentionDetail(
  result: CancelOwnedExternalRecoveriesResult,
): string | undefined {
  if (result.issues.length === 0) return undefined;
  return result.issues.map((issue) => `${issue.count} ${issue.kind}: ${issue.reason}`).join('; ');
}

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
  clearPendingRunState: (conversationId: string, runId: string) => void;
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
  params.clearPendingRunState(params.conversationId, activeRunId);
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
  params.actions.clearPendingRunState(params.conversationId, params.runId);
  const terminalized = applyConversationRunCompletionEffect({
    actions: params.actions,
    conversationId: params.conversationId,
    effect: supersedeEffect.completion,
    getLatestConversation: () => params.actions.getLatestConversation(params.conversationId),
    runId: params.runId,
  });
  cancelRunningSubAgentsForRun(params.conversation, params.runId, supersedeEffect.workerReason);
  const latestRun = params.actions
    .getLatestConversation(params.conversationId)
    ?.agentRuns?.find((run) => run.id === params.runId);
  if (terminalized || latestRun?.status === 'cancelled') {
    params.actions.appendConversationLog(params.conversationId, supersedeEffect.logEntry);
  }
}

export function stopForegroundConversationRuns(params: {
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => boolean;
  actions: ForegroundConversationCancellationActions;
  cancelOwnedRecoveries?: typeof cancelOwnedExternalRecoveries;
  conversation?: Conversation;
  conversationId: string;
}): Promise<void> {
  const runsToCancel = params.conversation
    ? getRunningConversationRunsForCancellation(params.conversation)
    : [];
  const didAbortForegroundRequest = params.abortForegroundRequestForConversation(
    params.conversationId,
    USER_STOP_REASON,
  );
  params.actions.clearForegroundRequestForConversation?.(params.conversationId);

  const fencedRuns = runsToCancel.map((run) => {
    const runWorkers = params.conversation
      ? getRunningLiveSubAgentsForRun(params.conversation, run.id)
      : [];
    const cancellationEffect = buildForegroundRunUserStopCompletionEffect(runWorkers.length);

    cancelAgentRunOperations(params.conversationId, run.id, cancellationEffect.operationReason);
    if (params.conversation) {
      cancelRunningSubAgentsForRun(params.conversation, run.id, cancellationEffect.workerReason);
    }

    return { cancellationEffect, run, runWorkers };
  });

  return fencedRuns
    .reduce<Promise<{ cancelledRunCount: number; cancelledWorkerCount: number }>>(
      async (countPromise, fencedRun) => {
      const counts = await countPromise;
      const { cancellationEffect, run, runWorkers } = fencedRun;

      let durableCancellation: CancelOwnedExternalRecoveriesResult;
      try {
        durableCancellation = await (params.cancelOwnedRecoveries ?? cancelOwnedExternalRecoveries)(
          {
            conversationId: params.conversationId,
            ownerRunId: run.id,
            reason: cancellationEffect.operationReason,
          },
        );
      } catch {
        durableCancellation = {
          cancelledRunCount: 0,
          settledRunCount: 0,
          issues: [{ kind: 'deferred', reason: 'journal_unavailable', count: 1 }],
        };
      }
      const attentionDetail = durableCancellationAttentionDetail(durableCancellation);
      if (attentionDetail) {
        params.actions.appendConversationLog(params.conversationId, {
          kind: 'error',
          level: 'warning',
          title: 'Durable cancellation needs attention',
          detail: attentionDetail,
        });
      }

      params.actions.clearPendingRunState(params.conversationId, run.id);
      const terminalized = applyConversationRunCompletionEffect({
        actions: params.actions,
        conversationId: params.conversationId,
        effect: cancellationEffect,
        getLatestConversation: () => params.actions.getLatestConversation(params.conversationId),
        runId: run.id,
      });
      clearAgentRunCancellation(params.conversationId, run.id);
      const latestRun = params.actions
        .getLatestConversation(params.conversationId)
        ?.agentRuns?.find((candidate) => candidate.id === run.id);
      const cancellationSettled = terminalized || latestRun?.status === 'cancelled';
      if (cancellationSettled) {
        const workspaceTarget = resolveConversationWorkspaceTarget({
          conversationId: params.conversationId,
          conversations: params.conversation ? [params.conversation] : [],
        });
        void params.actions
          .ensureAgentRunFinalResponse?.({
            conversationId: params.conversationId,
            runId: run.id,
            status: 'cancelled',
            memoryConversationId: workspaceTarget.workspaceConversationId,
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
      }
      return {
        cancelledRunCount: counts.cancelledRunCount + (cancellationSettled ? 1 : 0),
        cancelledWorkerCount: counts.cancelledWorkerCount + runWorkers.length,
      };
    }, Promise.resolve({ cancelledRunCount: 0, cancelledWorkerCount: 0 }))
    .then(({ cancelledRunCount, cancelledWorkerCount }) => {
      if (cancelledRunCount === 0 && !(runsToCancel.length === 0 && didAbortForegroundRequest)) {
        return;
      }
      params.actions.appendConversationLog(
        params.conversationId,
        buildForegroundRunUserStopLogEntry({
          cancelledRunCount,
          cancelledWorkerCount,
        }),
      );
    });
}
