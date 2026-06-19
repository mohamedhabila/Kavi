import { type AgentControlGraphFinalReviewGate } from '../finalReviewGate';
import { useChatStore } from '../../../store/useChatStore';
import { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import { Conversation, ConversationLogEntry } from '../../../types/conversation';
import { ResumeAgentRun } from './contracts';
import { buildForegroundRunReviewContext, type ForegroundRunReviewContext } from './reviewContext';

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

export async function handleForegroundRunReviewFinalDelivery(params: {
  appendConversationLog: AppendConversationLog;
  assertNotAborted: () => void;
  conversationId: string;
  finalizeTrackedRun: FinalizeTrackedRun;
  getLatestConversation: () => Conversation | undefined;
  recoverAgentRunFinalPreview: RecoverAgentRunFinalPreview;
  resumeAgentRun?: ResumeAgentRun | null;
  runId: string;
  signal: AbortSignal;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  context: ForegroundRunReviewContext;
}): Promise<{ handled: true } | ({ handled: false } & ForegroundRunReviewContext)> {
  if (params.context.finalReviewGate.type !== 'recover') {
    return { handled: false, ...params.context };
  }

  const recoveryGate = params.context.finalReviewGate;
  let reviewContext = params.context;
  let finalReviewGate: AgentControlGraphFinalReviewGate = recoveryGate;
  const recoveryTimestamp = Date.now();
  params.appendConversationLog(params.conversationId, {
    kind: 'state',
    level: recoveryGate.logLevel,
    title: recoveryGate.checkpointTitle,
    detail: recoveryGate.checkpointDetail,
    timestamp: recoveryTimestamp,
  });

  params.assertNotAborted();
  const finalPreview = await params.recoverAgentRunFinalPreview(
    'completed',
    recoveryTimestamp,
    undefined,
    params.signal,
  );
  params.assertNotAborted();

  if (finalPreview.preview) {
    const refreshedConversation = params.getLatestConversation();
    const refreshedRun = refreshedConversation?.agentRuns?.find(
      (candidate) => candidate.id === params.runId,
    );
    if (refreshedConversation && refreshedRun) {
      reviewContext = buildForegroundRunReviewContext({
        reviewConversation: refreshedConversation,
        reviewRun: refreshedRun,
      });
      finalReviewGate = reviewContext.finalReviewGate;
    }
  }

  if (finalReviewGate.type !== 'recover') {
    return {
      handled: false,
      ...reviewContext,
    };
  }

  if (params.resumeAgentRun) {
    params.setAgentRunPhase(
      params.conversationId,
      'deliver',
      {
        status: 'active',
        detail: finalReviewGate.checkpointDetail,
        checkpointTitle: finalReviewGate.checkpointTitle,
        checkpointDetail: finalReviewGate.checkpointDetail,
        timestamp: recoveryTimestamp,
      },
      params.runId,
    );
    params.updateAgentRunSummary(
      params.conversationId,
      {
        latestSummary: finalReviewGate.checkpointDetail,
        timestamp: recoveryTimestamp,
      },
      params.runId,
    );

    await params.resumeAgentRun?.({
      conversationId: params.conversationId,
      runId: params.runId,
      additionalSystemPrompt: finalReviewGate.systemPrompt,
      additionalUserPrompt: finalReviewGate.userPrompt,
      disableTools: true,
      reuseAssistantDraft: false,
    });
    params.assertNotAborted();
    return { handled: true };
  }

  params.finalizeTrackedRun(
    'failed',
    finalReviewGate.checkpointDetail,
    finalReviewGate.checkpointTitle,
    finalReviewGate.checkpointDetail,
    'tool_failure',
  );
  params.appendConversationLog(params.conversationId, {
    kind: 'state',
    level: 'error',
    title: finalReviewGate.checkpointTitle,
    detail: `${finalReviewGate.checkpointDetail} Supervisor recovery was unavailable.`,
    timestamp: recoveryTimestamp,
  });
  return { handled: true };
}
