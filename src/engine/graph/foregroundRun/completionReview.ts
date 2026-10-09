import { AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE } from '../finalDelivery';
import { useChatStore } from '../../../store/useChatStore';
import { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import { ConversationLogEntry } from '../../../types/conversation';
import { RecoverAgentRunFinalPreview, ResumeAgentRun } from './contracts';
import { handleForegroundRunReviewFinalDelivery } from './reviewFinalDelivery';
import { buildForegroundRunReviewContext } from './reviewContext';
import { buildAgentControlGraphTerminalReviewCompletion } from './completionReviewTerminal';
import { hasBlockedBlockingGoals, isBlockingGoal } from '../../goals/types';
import { areBlockingGoalsStructurallyComplete } from '../../goals/completionEvidence';
import { isBlockingGoalClosedWithoutProof } from '../../goals/goalProof';

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

export type ForegroundRunCompletionReviewResult =
  | { handled: true; terminalized: boolean }
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
  flushChatState: () => Promise<void>;
  recoverAgentRunFinalPreview: RecoverAgentRunFinalPreview;
  resumeAgentRun?: ResumeAgentRun | null;
  runId?: string;
  signal: AbortSignal;
  turnSummary: string;
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
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
    reviewContext.targetMessage,
  );
  if (terminalCompletion) {
    const terminalized = params.finalizeTrackedRun(
      terminalCompletion.status,
      terminalCompletion.latestSummary,
      terminalCompletion.checkpointTitle,
      terminalCompletion.checkpointDetail,
      terminalCompletion.terminalReason,
    );
    if (terminalized) {
      params.appendConversationLog(params.conversationId, {
        kind: 'state',
        level: terminalCompletion.logLevel,
        title: terminalCompletion.logTitle,
        detail: terminalCompletion.logDetail,
      });
    }
    return { handled: true, terminalized };
  }

  const finalDeliveryResult = await handleForegroundRunReviewFinalDelivery({
    appendConversationLog: params.appendConversationLog,
    assertNotAborted: params.assertNotAborted,
    conversationId: params.conversationId,
    finalizeTrackedRun: params.finalizeTrackedRun,
    flushChatState: params.flushChatState,
    getLatestConversation: () =>
      useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === params.conversationId),
    recoverAgentRunFinalPreview: params.recoverAgentRunFinalPreview,
    resumeAgentRun: params.resumeAgentRun,
    runId: params.runId,
    signal: params.signal,
    setAgentRunPhase: params.setAgentRunPhase,
    updateAgentRunControlGraph: params.updateAgentRunControlGraph,
    updateAgentRunSummary: params.updateAgentRunSummary,
    updateMessageAssistantMetadata: params.updateMessageAssistantMetadata,
    context: reviewContext,
  });
  if (finalDeliveryResult.handled) {
    return finalDeliveryResult;
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

  const goals = reviewContext.reviewRun.controlGraph?.goals ?? [];
  if (hasBlockedBlockingGoals(goals)) {
    const detail = 'The workflow delivered a blocker report, but a required goal remains blocked.';
    return {
      handled: false,
      completionStatus: 'failed',
      latestSummary: reviewContext.finalReviewGate.candidatePreview,
      checkpointTitle: 'Run blocked',
      checkpointDetail: detail,
      completionTerminalReason: 'terminal_blocked',
      completionLogLevel: 'error',
      completionLogTitle: 'Run blocked',
      completionLogDetail: detail,
    };
  }

  // Finalization settles a run as completed only when every blocking goal is closed
  // *and* proven by its success criteria. A goal the model closed without that proof is
  // accepted as its bookkeeping, so this review must not offer the run a success that
  // finalization will refuse: the refusal used to leave the run running behind a
  // delivered answer, and closing the generation then failed on it.
  if (!areBlockingGoalsStructurallyComplete(goals)) {
    const unfinished = goals.filter(
      (goal) => isBlockingGoal(goal) && !areBlockingGoalsStructurallyComplete([goal]),
    );
    const closedWithoutProof = unfinished.filter(isBlockingGoalClosedWithoutProof);
    const stillOpen = unfinished.filter((goal) => !isBlockingGoalClosedWithoutProof(goal));
    const detail =
      [
        'The workflow delivered an answer, but',
        [
          closedWithoutProof.length > 0
            ? `a required goal was closed without the evidence its success criteria require: ${closedWithoutProof.map((goal) => goal.id).join(', ')}`
            : '',
          stillOpen.length > 0
            ? `a required goal is still open: ${stillOpen.map((goal) => goal.id).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('; and '),
      ].join(' ') + '.';
    return {
      handled: false,
      completionStatus: 'failed',
      latestSummary: reviewContext.finalReviewGate.candidatePreview,
      checkpointTitle: 'Run blocked',
      checkpointDetail: detail,
      completionTerminalReason: 'terminal_blocked',
      completionLogLevel: 'error',
      completionLogTitle: 'Run blocked',
      completionLogDetail: detail,
    };
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
