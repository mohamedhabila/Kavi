import type { AgentControlGraphTerminalBackgroundReviewContext } from '../engine/graph/terminalBackgroundReviewContext';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponse,
} from '../services/agents/lifecycle/agentRunStateMachine';
import { useChatStore } from '../store/useChatStore';
import type { ConversationLogEntry } from '../types/conversation';
import type { ResumeAgentRun } from '../engine/graph/foregroundRun/contracts';
import { completeTerminalBackgroundReviewRun } from './terminalBackgroundCompletion';
import type { RecordConversationTurnMemory } from '../services/memory/core/memoryCapture';

type ChatStore = ReturnType<typeof useChatStore.getState>;

/** Shown to the model when it resumes the run whose background workers all finished. */
export const BACKGROUND_WORKERS_FINISHED_RESUME_PROMPT =
  'Your background workers have finished; their results are in the conversation. Answer the request with them.';

/**
 * Settles a run once every background worker it started has finished. A run that already
 * answered completes with that answer. A run that has not is resumed through the agent loop,
 * with its tools, to answer from its workers' results: nothing writes an answer on its behalf.
 */
export async function handleTerminalBackgroundReview(params: {
  appendConversationLog: ChatStore['addConversationLog'];
  assertNotAborted: () => void;
  completeAgentRun: ChatStore['completeAgentRun'];
  conversationId: string;
  context: AgentControlGraphTerminalBackgroundReviewContext;
  flushChatState: () => Promise<void>;
  recordConversationTurnMemory: RecordConversationTurnMemory;
  resumeAgentRun?: ResumeAgentRun | null;
  reviewTimestamp: number;
  runId: string;
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
}): Promise<void> {
  const { conversation, targetRun, candidateSummary, candidateStatus } = params.context;
  const status = candidateStatus === 'completed' ? 'completed' : 'failed';
  const checkpointTitle =
    status === 'completed' ? 'Background workers finished' : 'Background worker review failed';
  const finalResponse = getLatestAssistantProjectionFinalResponse(
    conversation.messages,
    buildAgentRunMessageScope(targetRun),
  );

  if (!finalResponse) {
    if (!params.resumeAgentRun) return;
    params.appendConversationLog(params.conversationId, {
      kind: 'state',
      level: 'info',
      title: 'Background workers finished',
      detail: candidateSummary,
      timestamp: params.reviewTimestamp,
    });
    await params.flushChatState();
    params.assertNotAborted();
    await params.resumeAgentRun({
      conversationId: params.conversationId,
      runId: params.runId,
      additionalSystemPrompt: BACKGROUND_WORKERS_FINISHED_RESUME_PROMPT,
      assistantDraftMode: 'new',
    });
    return;
  }

  await params.flushChatState();
  params.assertNotAborted();
  params.recordConversationTurnMemory(params.conversationId, finalResponse.id);

  const completed = completeTerminalBackgroundReviewRun({
    appendConversationLog: params.appendConversationLog,
    completeAgentRun: params.completeAgentRun,
    completion: {
      status,
      latestSummary: finalResponse.content.trim(),
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
  await params.flushChatState();
}
