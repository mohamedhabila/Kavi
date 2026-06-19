import type { Message } from '../../types/message';
import { type RequestAssessment } from '../../services/agents/requestGovernance';
import { hasModelVisibleAttachments } from '../../utils/messageAttachments';
import { getUserMessagePromptContent } from '../prompts/orchestratorPromptSections';
import { selectAgentControlGraphModelContextMessages } from './modelContext';
import { assessGraphEntryRequest } from './requestEntrySignals';

type PrepareAgentControlGraphRequestContextParams = {
  graphOwnedRun: boolean;
  memoryScopedMessages: ReadonlyArray<Message>;
  workflowScopeUserMessageId?: string;
};

export type AgentControlGraphRequestContext = {
  graphOwnedModelContextMessages: Message[];
  hasWorkflowScopeAnchor: boolean;
  lastUserMessageText: string;
  missingWorkflowScopeAnchorId?: string;
  requestAssessment: RequestAssessment;
  requestContextLastUserMessage?: Message;
};

function selectUserMessages(messages: ReadonlyArray<Message>): Message[] {
  return messages.filter((message) => message.role === 'user');
}

export function prepareAgentControlGraphRequestContext(
  params: PrepareAgentControlGraphRequestContextParams,
): AgentControlGraphRequestContext {
  const normalizedWorkflowScopeUserMessageId = params.workflowScopeUserMessageId?.trim() || '';
  const memoryScopedUserMessages = selectUserMessages(params.memoryScopedMessages);
  const requestContextLastUserMessage =
    memoryScopedUserMessages[memoryScopedUserMessages.length - 1];
  const lastUserMessageText = requestContextLastUserMessage
    ? getUserMessagePromptContent(requestContextLastUserMessage)
    : '';
  const requestAssessment = assessGraphEntryRequest({
    text: lastUserMessageText,
    hasAttachments: hasModelVisibleAttachments(requestContextLastUserMessage?.attachments),
  });
  const workflowCandidateRequest = requestAssessment.action !== 'clarify';
  const graphOwnedModelContextMessages =
    params.graphOwnedRun && workflowCandidateRequest
      ? selectAgentControlGraphModelContextMessages({
          memoryScopedMessages: [...params.memoryScopedMessages],
          graphOwnedRun: params.graphOwnedRun,
        })
      : [...params.memoryScopedMessages];
  const requestContextUserMessages = selectUserMessages(graphOwnedModelContextMessages);
  const hasWorkflowScopeAnchor =
    workflowCandidateRequest && normalizedWorkflowScopeUserMessageId
      ? graphOwnedModelContextMessages.some(
          (message) =>
            message.role === 'user' && message.id === normalizedWorkflowScopeUserMessageId,
        )
      : false;
  const effectiveRequestContextLastUserMessage =
    requestContextUserMessages[requestContextUserMessages.length - 1] ??
    requestContextLastUserMessage;
  return {
    graphOwnedModelContextMessages,
    hasWorkflowScopeAnchor,
    lastUserMessageText,
    ...(normalizedWorkflowScopeUserMessageId && !hasWorkflowScopeAnchor
      ? workflowCandidateRequest
        ? { missingWorkflowScopeAnchorId: normalizedWorkflowScopeUserMessageId }
        : {}
      : {}),
    requestAssessment,
    ...(effectiveRequestContextLastUserMessage
      ? { requestContextLastUserMessage: effectiveRequestContextLastUserMessage }
      : {}),
  };
}
