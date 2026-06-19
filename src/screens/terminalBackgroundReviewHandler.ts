import type { AgentControlGraphTerminalBackgroundReviewContext } from '../engine/graph/terminalBackgroundReviewContext';
import {
  buildAgentRunMessageScope,
  hasDeliveredFinalAssistantResponse,
} from '../services/agents/lifecycle/agentRunStateMachine';
import { useChatStore } from '../store/useChatStore';
import { ConversationLogEntry } from '../types/conversation';
import { findLatestPreferredAgentRunAssistantMessageId } from '../engine/graph/foregroundRun/assistantMessages';
import {
  EnsureAgentRunFinalResponse,
  ResumeAgentRun,
} from '../engine/graph/foregroundRun/contracts';
import { completeTerminalBackgroundReviewRun } from './terminalBackgroundCompletion';

type ChatStore = ReturnType<typeof useChatStore.getState>;

function hasIncompleteGoals(goals: ReadonlyArray<{ status: string }> | undefined): boolean {
  return (goals ?? []).some((goal) => goal.status === 'active' || goal.status === 'pending');
}

export async function handleTerminalBackgroundReview(params: {
  appendConversationLog: ChatStore['addConversationLog'];
  assertNotAborted: () => void;
  completeAgentRun: ChatStore['completeAgentRun'];
  conversationId: string;
  context: AgentControlGraphTerminalBackgroundReviewContext;
  ensureAgentRunFinalResponse?: EnsureAgentRunFinalResponse | null;
  resumeAgentRun?: ResumeAgentRun | null;
  reviewTimestamp: number;
  runId: string;
  signal: AbortSignal;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  updateAgentRunAsyncWork: ChatStore['updateAgentRunAsyncWork'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
}): Promise<void> {
  const { conversation, targetRun, candidateSummary, candidateStatus } = params.context;
  const goals = targetRun.controlGraph?.goals ?? [];

  if (hasIncompleteGoals(goals) && params.resumeAgentRun) {
    params.setAgentRunPhase(
      params.conversationId,
      'work',
      {
        status: 'active',
        detail: candidateSummary,
        checkpointTitle: 'Goals still open',
        checkpointDetail: candidateSummary,
      },
      params.runId,
    );
    await params.resumeAgentRun({
      conversationId: params.conversationId,
      runId: params.runId,
      additionalSystemPrompt:
        'Background workers finished, but goals are still open. Continue executing the active goal set.',
      additionalUserPrompt: candidateSummary,
    });
    return;
  }

  const status =
    candidateStatus === 'completed' && !hasIncompleteGoals(goals) ? 'completed' : 'failed';
  const checkpointTitle =
    status === 'completed' ? 'Background workers finished' : 'Background worker review failed';
  const runMessageScope = buildAgentRunMessageScope(targetRun);
  let latestSummary = candidateSummary;

  if (!hasDeliveredFinalAssistantResponse(conversation.messages, runMessageScope)) {
    const preferredAssistantMessageId = findLatestPreferredAgentRunAssistantMessageId(
      conversation.messages,
      runMessageScope,
    );
    const finalResponsePreview = await params.ensureAgentRunFinalResponse?.({
      conversationId: params.conversationId,
      runId: params.runId,
      status,
      preferredAssistantMessageId,
      timestamp: params.reviewTimestamp,
      signal: params.signal,
    });
    params.assertNotAborted();
    if (finalResponsePreview) {
      latestSummary = finalResponsePreview;
    }
  }

  completeTerminalBackgroundReviewRun({
    appendConversationLog: params.appendConversationLog,
    completeAgentRun: params.completeAgentRun,
    completion: {
      status,
      latestSummary,
      checkpointTitle,
      checkpointDetail: candidateSummary,
      logLevel: (status === 'completed' ? 'info' : 'warning') as ConversationLogEntry['level'],
      logTitle: checkpointTitle,
      logDetail: candidateSummary,
    },
    conversationId: params.conversationId,
    reviewTimestamp: params.reviewTimestamp,
    runId: params.runId,
    targetRun,
  });
}
