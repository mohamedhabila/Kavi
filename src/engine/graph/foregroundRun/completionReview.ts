import { AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE } from '../finalDelivery';
import { useChatStore } from '../../../store/useChatStore';
import { AgentRun, AgentRunTerminalReason } from '../../../types/agentRun';
import { ConversationLogEntry } from '../../../types/conversation';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponse,
} from '../../../services/agents/lifecycle/agentRunStateMachine';
import { buildAgentControlGraphTerminalReviewCompletion } from './completionReviewTerminal';
import { findLatestAgentRunAssistantMessageId } from './assistantMessages';
import { buildForegroundAssistantIncompleteMetadata } from './terminalLifecycle';

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

const DIRECT_COMPLETION_DETAIL =
  'The workflow produced a visible final answer and completed without a separate review pass.';
const NO_ANSWER_TITLE = 'Run ended without an answer';
const NO_ANSWER_DETAIL = 'The run ended without a final answer.';

/**
 * How a foreground run that finished without an error ends. Only the agent loop writes an
 * answer: a run whose graph reached a failed or blocked state ends that way, a run with a
 * final answer completes with it, and a run without one fails with what it streamed and the
 * error in view. Nothing writes, synthesizes or re-requests an answer on its behalf.
 */
export function reviewForegroundRunCompletion(params: {
  appendConversationLog: AppendConversationLog;
  conversationId: string;
  finalizeTrackedRun: FinalizeTrackedRun;
  runId?: string;
  setChatError: (message: string | null) => void;
  turnSummary: string;
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
}): ForegroundRunCompletionReviewResult {
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

  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  const run = conversation?.agentRuns?.find((candidate) => candidate.id === params.runId);
  if (!conversation || !run) {
    return defaultCompletion;
  }

  const runMessageScope = buildAgentRunMessageScope(run);
  const targetMessageId = findLatestAgentRunAssistantMessageId(
    conversation.messages,
    runMessageScope,
  );
  const targetMessage = targetMessageId
    ? conversation.messages.find((message) => message.id === targetMessageId)
    : undefined;

  const terminalCompletion = buildAgentControlGraphTerminalReviewCompletion(
    run.controlGraph,
    targetMessage,
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

  // The same final the run's completion boundary accepts (inspectPersistedAgentRunFinalDelivery).
  const finalAnswer = getLatestAssistantProjectionFinalResponse(
    conversation.messages,
    runMessageScope,
  )?.content.trim();
  if (finalAnswer) {
    return {
      handled: false,
      completionStatus: 'completed',
      latestSummary: finalAnswer,
      checkpointTitle: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE,
      checkpointDetail: DIRECT_COMPLETION_DETAIL,
      completionLogLevel: 'success',
      completionLogTitle: AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE,
      completionLogDetail: DIRECT_COMPLETION_DETAIL,
    };
  }

  // A draft is marked failed; a final the run wrote itself (a step-limit or loop stop) keeps
  // its own disposition, so the person can still carry the task on from it.
  if (targetMessage && targetMessage.assistantMetadata?.kind !== 'final') {
    params.updateMessageAssistantMetadata(
      params.conversationId,
      targetMessage.id,
      buildForegroundAssistantIncompleteMetadata('response_failed'),
    );
  }
  params.setChatError(NO_ANSWER_DETAIL);
  return {
    handled: false,
    completionStatus: 'failed',
    latestSummary: targetMessage?.content.trim() || NO_ANSWER_DETAIL,
    checkpointTitle: NO_ANSWER_TITLE,
    checkpointDetail: NO_ANSWER_DETAIL,
    completionLogLevel: 'error',
    completionLogTitle: NO_ANSWER_TITLE,
    completionLogDetail: `${params.turnSummary} · ${NO_ANSWER_DETAIL}`,
  };
}
