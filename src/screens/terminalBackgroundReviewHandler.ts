import type { AgentControlGraphTerminalBackgroundReviewContext } from '../engine/graph/terminalBackgroundReviewContext';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponsePreview,
} from '../services/agents/lifecycle/agentRunStateMachine';
import { useChatStore } from '../store/useChatStore';
import { ConversationLogEntry } from '../types/conversation';
import { findLatestPreferredAgentRunAssistantMessageId } from '../engine/graph/foregroundRun/assistantMessages';
import { resolveConversationWorkspaceTarget } from '../services/conversationWorkspace/ownership';
import {
  EnsureAgentRunFinalResponse,
  ResumeAgentRun,
} from '../engine/graph/foregroundRun/contracts';
import { completeTerminalBackgroundReviewRun } from './terminalBackgroundCompletion';
import type { RecordConversationTurnMemory } from './chatTurnMemory';
import {
  hasIncompleteBlockingGoals,
  hasResumableBlockingGoals,
} from '../engine/goals/types';

type ChatStore = ReturnType<typeof useChatStore.getState>;

export async function handleTerminalBackgroundReview(params: {
  appendConversationLog: ChatStore['addConversationLog'];
  assertNotAborted: () => void;
  completeAgentRun: ChatStore['completeAgentRun'];
  conversationId: string;
  context: AgentControlGraphTerminalBackgroundReviewContext;
  ensureAgentRunFinalResponse?: EnsureAgentRunFinalResponse | null;
  recordConversationTurnMemory: RecordConversationTurnMemory;
  resumeAgentRun?: ResumeAgentRun | null;
  reviewTimestamp: number;
  runId: string;
  signal: AbortSignal;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  updateAgentRunAsyncWork: ChatStore['updateAgentRunAsyncWork'];
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
}): Promise<void> {
  const { conversation, targetRun, candidateSummary, candidateStatus } = params.context;
  const goals = targetRun.controlGraph?.goals ?? [];

  if (hasResumableBlockingGoals(goals) && params.resumeAgentRun) {
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
    candidateStatus === 'completed' && !hasIncompleteBlockingGoals(goals)
      ? 'completed'
      : 'failed';
  const checkpointTitle =
    status === 'completed' ? 'Background workers finished' : 'Background worker review failed';
  const runMessageScope = buildAgentRunMessageScope(targetRun);
  let latestSummary = candidateSummary;

  if (
    !getLatestAssistantProjectionFinalResponsePreview(conversation.messages, runMessageScope)
  ) {
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

  const settledConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  const settledRun = settledConversation?.agentRuns?.find(
    (candidate) => candidate.id === params.runId,
  );
  if (!settledConversation || !settledRun) return;
  const settledRunMessageScope = buildAgentRunMessageScope(settledRun);
  const settledFinalResponse = getLatestAssistantProjectionFinalResponsePreview(
    settledConversation.messages,
    settledRunMessageScope,
  );
  if (!settledFinalResponse) return;
  latestSummary = settledFinalResponse;

  const completed = completeTerminalBackgroundReviewRun({
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
    updateAgentRunControlGraph: params.updateAgentRunControlGraph,
  });
  if (!completed) return;
  const workspaceTarget = resolveConversationWorkspaceTarget({
    conversationId: params.conversationId,
    conversations: useChatStore.getState().conversations,
  });
  params.recordConversationTurnMemory(params.conversationId, undefined, {
    memoryConversationId: workspaceTarget.workspaceConversationId,
    sourceRunId: params.runId,
  });
}
