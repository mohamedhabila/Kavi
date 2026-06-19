import type { AgentControlGraphInterruptedResponseOutcome } from '../interruptedResponseRecovery';

const AGENT_CONTROL_GRAPH_GOALS_REVIEW_CHECKPOINT_TITLE = 'Goals review required';
import { useChatStore } from '../../../store/useChatStore';
import { buildAssistantMessageMetadata } from '../../../utils/assistantMessageMetadata';
import type { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import type { ConversationLogEntry } from '../../../types/conversation';
import type { ResumeAgentRun } from './contracts';

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
) => void;

type RecoverAgentRunFinalPreview = (
  status: Exclude<AgentRun['status'], 'running'>,
  timestamp?: number,
  preferredAssistantMessageId?: string,
  signal?: AbortSignal,
) => Promise<{ preview?: string; recovered: boolean }>;

export async function handleForegroundInterruptedResponseRecovery(params: {
  appendConversationLog: AppendConversationLog;
  assertNotAborted: () => void;
  clearForegroundRequestIfCurrent: () => boolean;
  conversationId: string;
  currentAssistantMessageId: string;
  errorMessage: string;
  finalizeTrackedRun: FinalizeTrackedRun;
  markCurrentAssistantDraftIncomplete: (
    visibleContent: string,
    finishReason: 'response_failed' | 'terminal_review_pending',
  ) => void;
  outcome: AgentControlGraphInterruptedResponseOutcome;
  recoverAgentRunFinalPreview: RecoverAgentRunFinalPreview;
  requestPersistenceCheckpoint: () => void;
  resumeAgentRun?: ResumeAgentRun | null;
  runId?: string | null;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  setChatError: (message: string | null) => void;
  signal: AbortSignal;
  updateAgentRunAsyncWork: ChatStore['updateAgentRunAsyncWork'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessage: ChatStore['updateMessage'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
  visibleContent: string;
}): Promise<void> {
  const { outcome, runId } = params;

  if (outcome.resumePrompt && runId && params.resumeAgentRun) {
    params.markCurrentAssistantDraftIncomplete(params.visibleContent, 'terminal_review_pending');
    params.setAgentRunPhase(
      params.conversationId,
      'work',
      {
        status: 'active',
        detail: outcome.checkpointDetail,
        checkpointTitle:
          outcome.checkpointTitle || AGENT_CONTROL_GRAPH_GOALS_REVIEW_CHECKPOINT_TITLE,
        checkpointDetail: outcome.checkpointDetail,
      },
      runId,
    );
    params.updateAgentRunSummary(
      params.conversationId,
      {
        latestSummary: outcome.checkpointDetail,
      },
      runId,
    );
    params.appendConversationLog(params.conversationId, {
      kind: 'state',
      level: 'warning',
      title: outcome.checkpointTitle,
      detail: outcome.checkpointDetail,
    });

    params.clearForegroundRequestIfCurrent();
    params.assertNotAborted();

    await params.resumeAgentRun({
      conversationId: params.conversationId,
      runId,
      additionalSystemPrompt: outcome.resumePrompt,
      additionalUserPrompt: outcome.resumeUserPrompt,
    });

    params.assertNotAborted();
    params.requestPersistenceCheckpoint();
    return;
  }

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

  const recoveredFinal = await params.recoverAgentRunFinalPreview(
    outcome.status,
    undefined,
    undefined,
    params.signal,
  );
  params.assertNotAborted();
  const latestSummary =
    recoveredFinal.preview || params.visibleContent || `Error: ${params.errorMessage}`;

  params.finalizeTrackedRun(
    outcome.status,
    latestSummary,
    outcome.checkpointTitle,
    outcome.checkpointDetail,
    outcome.terminalReason,
  );
  if (!recoveredFinal.recovered && outcome.status !== 'completed') {
    params.setChatError(params.errorMessage);
  }
  params.appendConversationLog(params.conversationId, {
    kind: 'error',
    level: outcome.status === 'completed' || recoveredFinal.recovered ? 'warning' : 'error',
    title:
      outcome.status === 'completed'
        ? 'Response interrupted; recovered final answer'
        : recoveredFinal.recovered
          ? outcome.checkpointTitle
          : 'Response failed',
    detail: outcome.status === 'completed' ? params.errorMessage : outcome.checkpointDetail,
  });

  if (!recoveredFinal.recovered && outcome.status !== 'completed') {
    params.updateMessage(
      params.conversationId,
      params.currentAssistantMessageId,
      params.visibleContent || `Error: ${params.errorMessage}`,
    );
    params.updateMessageAssistantMetadata(
      params.conversationId,
      params.currentAssistantMessageId,
      buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'response_failed',
      }),
    );
  }

  params.requestPersistenceCheckpoint();
}
