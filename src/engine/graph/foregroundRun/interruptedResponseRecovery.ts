import type { AgentControlGraphInterruptedResponseOutcome } from '../interruptedResponseRecovery';
import { useChatStore } from '../../../store/useChatStore';
import { buildAssistantMessageMetadata } from '../../../utils/assistantMessageMetadata';
import type { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import type { ConversationLogEntry } from '../../../types/conversation';

type ChatStore = ReturnType<typeof useChatStore.getState>;

type AppendConversationLog = (
  conversationId: string,
  entry: {
    title: string;
    detail?: string;
    level?: ConversationLogEntry['level'];
    kind?: ConversationLogEntry['kind'];
    timestamp?: number;
  },
) => void;

type FinalizeTrackedRun = (
  status: Exclude<AgentRun['status'], 'running'>,
  latestSummary: string,
  checkpointTitle: string,
  checkpointDetail?: string,
  terminalReason?: AgentRunTerminalReason,
) => boolean;

/**
 * Ends a foreground run whose model stream failed. A run still waiting on async operations
 * stays open in its work phase; any other run fails, keeping what it streamed and showing
 * the error, and the tools it finished stay shown as done. Nothing writes an answer for it.
 */
export function handleForegroundInterruptedResponseRecovery(params: {
  appendConversationLog: AppendConversationLog;
  assertNotAborted: () => void;
  conversationId: string;
  currentAssistantMessageId: string;
  errorMessage: string;
  finalizeTrackedRun: FinalizeTrackedRun;
  outcome: AgentControlGraphInterruptedResponseOutcome;
  requestPersistenceCheckpoint: () => void;
  runId?: string | null;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  setChatError: (message: string | null) => void;
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessage: ChatStore['updateMessage'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
  visibleContent: string;
}): void {
  const { outcome, runId } = params;

  if (runId && outcome.keepRunOpen === 'async-operations') {
    const reviewTimestamp = Date.now();
    params.setAgentRunPhase(
      params.conversationId,
      'work',
      {
        status: 'active',
        detail: outcome.checkpointDetail,
        checkpointTitle: outcome.checkpointTitle,
        checkpointDetail: outcome.checkpointDetail,
        timestamp: reviewTimestamp,
        allowRegression: true,
      },
      runId,
    );
    params.updateAgentRunSummary(
      params.conversationId,
      {
        latestSummary: outcome.checkpointDetail,
        timestamp: reviewTimestamp,
      },
      runId,
    );
    params.appendConversationLog(params.conversationId, {
      kind: 'state',
      level: 'warning',
      title: outcome.checkpointTitle,
      detail: outcome.checkpointDetail,
      timestamp: reviewTimestamp,
    });
    params.requestPersistenceCheckpoint();
    return;
  }

  params.assertNotAborted();
  const visibleFailure = params.visibleContent || `Error: ${params.errorMessage}`;

  const terminalized = params.finalizeTrackedRun(
    outcome.status,
    visibleFailure,
    outcome.checkpointTitle,
    outcome.checkpointDetail,
  );
  if (!terminalized) {
    const detail =
      'The terminal outcome could not be committed at the current control-graph boundary. Terminalization remains retryable.';
    if (runId) {
      params.setAgentRunPhase(
        params.conversationId,
        'review',
        {
          status: 'active',
          detail,
          checkpointTitle: 'Run terminalization recovery pending',
          checkpointDetail: detail,
          allowRegression: true,
        },
        runId,
      );
      params.updateAgentRunSummary(params.conversationId, { latestSummary: detail }, runId);
    }
    params.appendConversationLog(params.conversationId, {
      kind: 'state',
      level: 'warning',
      title: 'Run terminalization recovery pending',
      detail,
    });
    params.requestPersistenceCheckpoint();
    return;
  }

  params.setChatError(params.errorMessage);
  params.appendConversationLog(params.conversationId, {
    kind: 'error',
    level: 'error',
    title: 'Response failed',
    detail: outcome.checkpointDetail,
  });
  params.updateMessage(params.conversationId, params.currentAssistantMessageId, visibleFailure);
  params.updateMessageAssistantMetadata(
    params.conversationId,
    params.currentAssistantMessageId,
    buildAssistantMessageMetadata('final', {
      completionStatus: 'incomplete',
      finishReason: 'response_failed',
    }),
  );
  params.requestPersistenceCheckpoint();
}
