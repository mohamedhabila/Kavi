import { AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE } from '../finalDelivery';
import { useChatStore } from '../../../store/useChatStore';
import { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import { ConversationLogEntry } from '../../../types/conversation';
import { ResumeAgentRun } from './contracts';
import { handleForegroundRunReviewFinalDelivery } from './reviewFinalDelivery';
import { buildForegroundRunReviewContext } from './reviewContext';
import { buildAgentControlGraphTerminalReviewCompletion } from './completionReviewTerminal';

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

export type ForegroundRunCompletionReviewResult =
  | { handled: true }
  | {
      handled: false;
      completionStatus: Exclude<AgentRun['status'], 'running'>;
      latestSummary: string;
      checkpointTitle: string;
      checkpointDetail: string;
      completionTerminalReason?: AgentRunTerminalReason;
      completionLogLevel: ConversationLogEntry['level'];
      completionLogTitle: string;
      completionLogDetail: string;
    };

export async function reviewForegroundRunCompletion(params: {
  appendConversationLog: AppendConversationLog;
  assertNotAborted: () => void;
  conversationId: string;
  finalizeTrackedRun: FinalizeTrackedRun;
  recoverAgentRunFinalPreview: RecoverAgentRunFinalPreview;
  resumeAgentRun?: ResumeAgentRun | null;
  runId?: string;
  signal: AbortSignal;
  turnSummary: string;
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
}): Promise<ForegroundRunCompletionReviewResult> {
  const defaultCompletion = {
    handled: false as const,
    completionStatus: 'completed' as const,
    latestSummary: params.turnSummary,
    checkpointTitle: 'Turn completed',
    checkpointDetail: params.turnSummary,
    completionLogLevel: 'success' as const,
    completionLogTitle: 'Turn completed',
    completionLogDetail: params.turnSummary,
  };

  if (!params.runId) {
    return defaultCompletion;
  }

  const latestConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  const targetRun = latestConversation?.agentRuns?.find(
    (candidate) => candidate.id === params.runId,
  );

  if (!latestConversation || !targetRun) {
    return defaultCompletion;
  }

  let reviewContext = buildForegroundRunReviewContext({
    reviewConversation: latestConversation,
    reviewRun: targetRun,
  });

  const terminalCompletion = buildAgentControlGraphTerminalReviewCompletion(
    reviewContext.reviewRun.controlGraph,
  );
  if (terminalCompletion) {
    params.finalizeTrackedRun(
      terminalCompletion.status,
      terminalCompletion.latestSummary,
      terminalCompletion.checkpointTitle,
      terminalCompletion.checkpointDetail,
      terminalCompletion.terminalReason,
    );
    params.appendConversationLog(params.conversationId, {
      kind: 'state',
      level: terminalCompletion.logLevel,
      title: terminalCompletion.logTitle,
      detail: terminalCompletion.logDetail,
    });
    return { handled: true };
  }

  const finalDeliveryResult = await handleForegroundRunReviewFinalDelivery({
    appendConversationLog: params.appendConversationLog,
    assertNotAborted: params.assertNotAborted,
    conversationId: params.conversationId,
    finalizeTrackedRun: params.finalizeTrackedRun,
    getLatestConversation: () =>
      useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === params.conversationId),
    recoverAgentRunFinalPreview: params.recoverAgentRunFinalPreview,
    resumeAgentRun: params.resumeAgentRun,
    runId: params.runId,
    signal: params.signal,
    setAgentRunPhase: params.setAgentRunPhase,
    updateAgentRunSummary: params.updateAgentRunSummary,
    context: reviewContext,
  });
  if (finalDeliveryResult.handled) {
    return { handled: true };
  }

  reviewContext = finalDeliveryResult;
  return buildForegroundRunDirectCompletion(reviewContext) ?? defaultCompletion;
}

const DIRECT_COMPLETION_DETAIL =
  'The workflow produced a visible final answer and completed without a separate review pass.';

function buildForegroundRunDirectCompletion(
  reviewContext: ReturnType<typeof buildForegroundRunReviewContext>,
): ForegroundRunCompletionReviewResult | undefined {
  if (reviewContext.finalReviewGate.type !== 'ready') {
    return undefined;
  }

  return {
    handled: false,
    completionStatus: 'completed',
    latestSummary: reviewContext.finalReviewGate.candidatePreview,
    checkpointTitle: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE,
    checkpointDetail: DIRECT_COMPLETION_DETAIL,
    completionLogLevel: 'success',
    completionLogTitle: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE,
    completionLogDetail: DIRECT_COMPLETION_DETAIL,
  };
}
