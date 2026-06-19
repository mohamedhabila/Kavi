import {
  buildAgentControlGraphFinalReviewGate,
  type AgentControlGraphFinalReviewGate,
} from '../finalReviewGate';
import { collectAgentRunFinalizationEvidence } from '../../../services/agents/lifecycle/finalizePhase';
import { buildAgentRunMessageScope } from '../../../services/agents/lifecycle/agentRunStateMachine';
import type { AgentRun } from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import { findLatestAgentRunAssistantMessageId } from './assistantMessages';

export type ForegroundRunReviewContext = {
  reviewConversation: Conversation;
  reviewRun: AgentRun;
  workflowEvidence: ReturnType<typeof collectAgentRunFinalizationEvidence>;
  targetMessageId?: string;
  targetMessage?: Message;
  finalReviewGate: AgentControlGraphFinalReviewGate;
};

export function buildForegroundRunReviewContext(params: {
  reviewConversation: Conversation;
  reviewRun: AgentRun;
}): ForegroundRunReviewContext {
  const runMessageScope = buildAgentRunMessageScope(params.reviewRun);
  const workflowEvidence = collectAgentRunFinalizationEvidence(
    params.reviewConversation.messages,
    runMessageScope,
    params.reviewRun.summary.startedTools,
    { originalPromptOverride: params.reviewRun.goal },
  );
  const targetMessageId = findLatestAgentRunAssistantMessageId(
    params.reviewConversation.messages,
    runMessageScope,
  );
  const targetMessage = targetMessageId
    ? params.reviewConversation.messages.find((message) => message.id === targetMessageId)
    : undefined;
  const finalReviewGate = buildAgentControlGraphFinalReviewGate({
    candidateMessage: targetMessage,
  });

  return {
    reviewConversation: params.reviewConversation,
    reviewRun: params.reviewRun,
    workflowEvidence,
    targetMessageId,
    targetMessage,
    finalReviewGate,
  };
}
